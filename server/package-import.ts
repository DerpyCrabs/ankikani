import { Effect } from 'effect'
import { fromBinary } from '@bufbuild/protobuf'
import { Collection, type CollectionData } from 'ankipack'
import initSqlJs from 'sql.js/dist/sql-wasm.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DeckConfig_ConfigSchema } from '../node_modules/ankipack/dist/generated/anki/deck_config_pb.js'
import { Deck_NormalSchema } from '../node_modules/ankipack/dist/generated/anki/decks_pb.js'
import { Notetype_Template_ConfigSchema } from '../node_modules/ankipack/dist/generated/anki/notetypes_pb.js'
import { buildDeckConfig } from '../src/lib/adapters'
import type { AnkiCardInfo, SchedulingSettings } from '../src/lib/domain'
import { createSchema, DEFAULT_SETTINGS } from './owned'
import { activateCollection, collectionImport, withStagingDatabase, validateCollection } from './collection-import'

const sqlPromise = initSqlJs({
  useOldExtensionFunctions: false,
  locateFile: (file) => path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', 'sql.js', 'dist', file),
})

type Template = { Front:string; Back:string }

export interface PackageImportReport {
  file:string
  kind:'apkg'|'colpkg'
  decks:number
  notes:number
  cards:number
  reviews:number
  media:number
  compatibility:Array<{modelName:string;status:string;reason:string}>
  backup:string|null
}

const humanDeckName = (name:string) => name.replaceAll('\x1f','::')
const fields = (stored:string) => stored.split('\x1f')
const tags = (stored:string) => stored.trim() ? stored.trim().split(/\s+/) : []
const dayKey = (date:Date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
const step = (minutes:number): `${number}${'m'|'h'|'d'}` => Number.isInteger(minutes/1440) ? `${minutes/1440}d` : Number.isInteger(minutes/60) ? `${minutes/60}h` : `${minutes}m`

function templatesFor(data:CollectionData, notetypeId:number) {
  return Object.fromEntries(data.templates.filter((item)=>item.ntid===notetypeId).sort((a,b)=>a.ord-b.ord).map((item) => {
    const config = fromBinary(Notetype_Template_ConfigSchema,item.config)
    return [item.name,{Front:config.qFormat,Back:config.aFormat} satisfies Template]
  }))
}

function render(template:string, names:string[], values:string[], front='') {
  let output = template.replaceAll('{{FrontSide}}',()=>front)
  for (let index=0; index<names.length; index+=1) {
    const name = names[index]
    const value = values[index] ?? ''
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
    output = output
      .replace(new RegExp(`\\{\\{#${escaped}\\}\\}([\\s\\S]*?)\\{\\{/${escaped}\\}\\}`,'g'),value ? '$1' : '')
      .replace(new RegExp(`\\{\\{\\^${escaped}\\}\\}([\\s\\S]*?)\\{\\{/${escaped}\\}\\}`,'g'),value ? '' : '$1')
      .replace(new RegExp(`\\{\\{(?:[^}:]+:)*${escaped}\\}\\}`,'g'),()=>value)
  }
  return output
}

function cardMemory(data:string) {
  try {
    const value = JSON.parse(data || '{}') as {s?:unknown;d?:unknown;lrt?:unknown}
    const stability = typeof value.s==='number' && Number.isFinite(value.s) && value.s>0 ? value.s : null
    const difficulty = typeof value.d==='number' && Number.isFinite(value.d) && value.d>=1 && value.d<=10 ? value.d : null
    const lastReview = typeof value.lrt==='number' && Number.isFinite(value.lrt) && value.lrt>0 ? value.lrt*1000 : null
    return {stability,difficulty,lastReview}
  } catch { return {stability:null,difficulty:null,lastReview:null} }
}

function restoredQueue(type:number, due:number) {
  // Anki restores learning queues by distinguishing Unix seconds from day numbers.
  // https://github.com/ankitects/anki/blob/main/rslib/src/scheduler/filtered/card.rs
  if (type===1 || type===3) return due>1_000_000_000 ? 1 : 3
  return type
}

function schedule(configBytes:Uint8Array|undefined):SchedulingSettings {
  if (!configBytes) return DEFAULT_SETTINGS
  const value = fromBinary(DeckConfig_ConfigSchema,configBytes)
  const weights = value.fsrsParams6.length ? value.fsrsParams6 : value.fsrsParams5
  return {
    ...DEFAULT_SETTINGS,
    newPerDay:value.newPerDay,
    reviewsPerDay:value.reviewsPerDay,
    desiredRetention:value.desiredRetention || DEFAULT_SETTINGS.desiredRetention,
    maximumInterval:value.maximumReviewInterval || DEFAULT_SETTINGS.maximumInterval,
    learningSteps:(value.learnSteps.length ? value.learnSteps : [1,10]).map(step),
    relearningSteps:(value.relearnSteps.length ? value.relearnSteps : [10]).map(step),
    leechThreshold:value.leechThreshold || DEFAULT_SETTINGS.leechThreshold,
    burySiblings:value.buryNew || value.buryReviews || value.buryInterdayLearning,
    ...(weights.length ? {fsrsWeights:weights} : {}),
  }
}

export async function importPackage(filePath:string):Promise<PackageImportReport> {
  const extension = path.extname(filePath).toLowerCase()
  if (extension!=='.apkg' && extension!=='.colpkg') throw new Error('Choose an .apkg or .colpkg file.')
  const bytes = new Uint8Array(await Bun.file(filePath).arrayBuffer())
  return importPackageBytes(bytes,path.basename(filePath),extension.slice(1) as 'apkg'|'colpkg')
}

export async function importPackageBytes(bytes:Uint8Array,file:string,kind:'apkg'|'colpkg'):Promise<PackageImportReport> {
  return Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const SQL = yield* Effect.promise(() => sqlPromise)
    const { staging } = yield* collectionImport
    const data = Collection.open(bytes, SQL).data
    if (!data.notes.length || !data.cards.length) throw new Error('The package contains no study cards, so the current collection was not replaced.')
    const report = yield* withStagingDatabase(staging, targetDb => Effect.sync(() => {
      createSchema(targetDb)
      targetDb.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL')
      const deckNames = new Map(data.decks.map((deck)=>[deck.id,humanDeckName(deck.name)]))
      const notetypeNames = new Map(data.notetypes.map((item)=>[item.id,item.name]))
      const fieldNames = new Map(data.notetypes.map((item)=>[item.id,data.fields.filter((field)=>field.ntid===item.id).sort((a,b)=>a.ord-b.ord).map((field)=>field.name)]))
      const templateMaps = new Map(data.notetypes.map((item)=>[item.id,templatesFor(data,item.id)]))
      const noteRows = new Map(data.notes.map((note)=>[note.id,note]))
      const settingsByDeck = new Map(data.decks.map((deck)=>{
        let configId=1
        try { configId=Number(fromBinary(Deck_NormalSchema,deck.kind).configId)||1 } catch {}
        return [deck.id,schedule(data.deckConfig.find((item)=>item.id===configId)?.config)]
      }))
      const latestReview = new Map<number,number>()
      for (const review of data.revlog) if (review.id>(latestReview.get(review.cid)??0)) latestReview.set(review.cid,review.id)
      const creation = new Date(data.col.crt*1000); creation.setHours(0,0,0,0)
      const today = new Date(); today.setHours(0,0,0,0)
      const todayNumber = Math.floor((today.getTime()-creation.getTime())/86400000)
      const tomorrow = today.getTime()+86400000

      targetDb.transaction(() => {
        targetDb.query('INSERT INTO meta VALUES(?,?)').run('profile',`Imported ${file}`)
        targetDb.query('INSERT INTO meta VALUES(?,?)').run('imported_at',new Date().toISOString())
        targetDb.query('INSERT INTO meta VALUES(?,?)').run('source_package',file)
        for (const deck of data.decks) targetDb.query('INSERT INTO decks VALUES(?,?)').run(deck.id,deckNames.get(deck.id)!)
        for (const notetype of data.notetypes) targetDb.query('INSERT INTO models VALUES(?,?,?)').run(notetype.name,JSON.stringify(fieldNames.get(notetype.id)),JSON.stringify(templateMaps.get(notetype.id)))
        for (const note of data.notes) {
          const names = fieldNames.get(note.mid) ?? []
          const values = fields(note.flds)
          const stored = Object.fromEntries(names.map((name,index)=>[name,{value:values[index]??'',order:index}]))
          targetDb.query('INSERT INTO notes VALUES(?,?,?,?)').run(note.id,notetypeNames.get(note.mid)!,JSON.stringify(stored),JSON.stringify(tags(note.tags)))
        }
        for (const card of data.cards) {
          const note = noteRows.get(card.nid)!
          const names = fieldNames.get(note.mid) ?? []
          const values = fields(note.flds)
          const template = Object.values(templateMaps.get(note.mid) ?? {})[card.ord] ?? {Front:'',Back:''}
          const question = render(template.Front,names,values)
          const answer = render(template.Back,names,values,question)
          const deckName = deckNames.get(card.odid || card.did) ?? deckNames.get(card.did)
          if (!deckName) throw new Error(`Card ${card.id} refers to missing deck ${card.did}.`)
          const effectiveDue = card.odid && card.odue ? card.odue : card.due
          const scheduleQueue = card.queue<0 ? restoredQueue(card.type,effectiveDue) : card.queue
          const dueAt = scheduleQueue===2 || scheduleQueue===3
            ? today.getTime()+(effectiveDue-todayNumber)*86400000
            : scheduleQueue===1 || scheduleQueue===4 ? effectiveDue*1000 : effectiveDue
          const buriedUntil = card.queue===-2 || card.queue===-3 ? tomorrow : null
          const queue = buriedUntil ? scheduleQueue : card.queue
          const memory = cardMemory(card.data)
          const settings = settingsByDeck.get(card.odid || card.did) ?? DEFAULT_SETTINGS
          const stepCount = card.type===3 ? settings.relearningSteps.length : settings.learningSteps.length
          const remainingSteps = card.left%1000
          const learningStep = card.type===1 || card.type===3 ? Math.max(0,stepCount-remainingSteps) : 0
          targetDb.query(`INSERT INTO cards(id,note_id,deck_name,ord,question,answer,interval,type,queue,due,due_at,reps,lapses,remaining,modified,flags,buried_until,leech,stability,difficulty,scheduled_days,learning_steps,last_review)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(card.id,card.nid,deckName,card.ord,question,answer,card.ivl,card.type,queue,card.due,dueAt,card.reps,card.lapses,card.left,card.mod,card.flags,buriedUntil,card.lapses>=8?1:0,memory.stability??Math.max(.1,card.ivl),memory.difficulty??(card.factor>0?Math.max(1,Math.min(10,11-card.factor/1000)):5.5),Math.max(0,card.ivl),learningStep,memory.lastReview??latestReview.get(card.id)??null)
        }
        for (const review of data.revlog) targetDb.query('INSERT INTO revlog VALUES(?,?,?,?,?,?,?)').run(review.id,review.cid,review.ease,review.ivl,review.lastIvl,review.time,review.type)
        for (const media of data.media) targetDb.query('INSERT INTO media VALUES(?,?)').run(media.name,media.data)
        for (const deck of data.decks) {
          targetDb.query('INSERT INTO settings VALUES(?,?)').run(deckNames.get(deck.id)!,JSON.stringify(settingsByDeck.get(deck.id)))
        }
        const start = today.getTime()
        const end = start + 86400000
        for (const deckName of deckNames.values()) {
          const reviewed = Number((targetDb.query(`SELECT COUNT(*) count FROM revlog r JOIN cards c ON c.id=r.card_id
            WHERE r.id>=? AND r.id<? AND r.kind=1 AND c.deck_name=?`).get(start,end,deckName) as {count:number}).count)
          if (reviewed) targetDb.query('INSERT INTO daily_activity VALUES(?,?,0,?)').run(dayKey(today),deckName,reviewed)
        }
      })()

      const samples = data.notetypes.filter((notetype)=>data.notes.some((note)=>note.mid===notetype.id)).map((notetype) => {
        const names = fieldNames.get(notetype.id) ?? []
        const modelCards = data.cards.filter((card)=>noteRows.get(card.nid)?.mid===notetype.id).slice(0,3)
        return {
          modelName:notetype.name, fields:names, templates:templateMaps.get(notetype.id)!,
          templateCount:Object.keys(templateMaps.get(notetype.id)!).length,
          noteCount:data.notes.filter((note)=>note.mid===notetype.id).length,
          samples:modelCards.map((card) => {
            const note = noteRows.get(card.nid)!
            const values = fields(note.flds)
            return {cardId:card.id,note:card.nid,deckName:deckNames.get(card.did)!,modelName:notetype.name,ord:card.ord,
              fields:Object.fromEntries(names.map((name,index)=>[name,{value:values[index]??'',order:index}])),fieldOrder:0,
              question:'',answer:'',interval:card.ivl,type:card.type,queue:card.queue,due:card.due,reps:card.reps,lapses:card.lapses,left:card.left,mod:card.mod,flags:card.flags} satisfies AnkiCardInfo
          }),
        }
      })
      const compatibility = buildDeckConfig('Imported collection',samples).compatibility.map(({modelName,status,reason})=>({modelName,status,reason}))
      const counts = {notes:data.notes.length,cards:data.cards.length,reviews:data.revlog.length,media:data.media.length}
      validateCollection(targetDb, counts)
      return { file, kind, decks: data.decks.length, ...counts, compatibility }
    }))
    return { ...report, backup: activateCollection(staging) }
  })))

}

if (import.meta.main) {
  const file = process.argv[2]
  if (!file) throw new Error('Usage: bun run import -- path/to/file.apkg')
  console.log(JSON.stringify(await importPackage(path.resolve(file)),null,2))
}
