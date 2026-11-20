import { Effect } from 'effect'
import { invokeEffect } from './anki'
import { createSchema, DEFAULT_SETTINGS } from './owned'
import { activateCollection, collectionImport, withStagingDatabase, validateCollection } from './collection-import'
import type { SchedulingSettings } from '../src/lib/domain'
import { buildDeckConfig } from '../src/lib/adapters'
import { createEmptyCard, fsrs } from 'ts-fsrs'

type AnkiField = { value: string; order: number }
type CardInfo = {
  cardId:number; note:number; deckName:string; modelName:string; ord:number; fields:Record<string,AnkiField>
  question:string; answer:string; interval:number; type:number; queue:number; due:number; reps:number
  lapses:number; left:number; mod:number; flags:number
}
type NoteInfo = { noteId:number; modelName:string; fields:Record<string,AnkiField>; tags:string[] }
type Review = [number,number,number,number,number,number,number,number,number] | {
  id:number;cid:number;ease:number;ivl:number;lastIvl:number;time:number;type:number
}
type DeckConfig = {
  new?: { perDay?:number; delays?:number[]; bury?:boolean }
  rev?: { perDay?:number; maxIvl?:number; bury?:boolean }
  lapse?: { delays?:number[]; leechFails?:number }
  desiredRetention?:number; fsrsWeights?:number[]; fsrsParams6?:number[]
}

const chunks = <T>(items:T[], size=500) => Array.from({length:Math.ceil(items.length/size)},(_,i)=>items.slice(i*size,(i+1)*size))
const step = (minutes:number): `${number}${'m'|'h'|'d'}` => Number.isInteger(minutes/1440) ? `${minutes/1440}d` : Number.isInteger(minutes/60) ? `${minutes/60}h` : `${minutes}m`

const schedulerDay = Effect.fn('schedulerDay')(function* (cards: CardInfo[]) {
  const card = cards.find((item)=>item.queue===2)
  if (!card) return null
  let low=-1_000_000, high=1_000_000
  while (low<high) {
    const middle=Math.floor((low+high)/2)
    const matches=yield* invokeEffect<number[]>('findCards',{query:`cid:${card.cardId} prop:due<=${middle}`})
    if (matches.includes(card.cardId)) high=middle
    else low=middle+1
  }
  return card.due-low
})

function scheduling(config: DeckConfig | false): SchedulingSettings {
  if (!config) return DEFAULT_SETTINGS
  const weights = config.fsrsParams6?.length ? config.fsrsParams6 : config.fsrsWeights
  return {
    ...DEFAULT_SETTINGS,
    newPerDay: config.new?.perDay ?? DEFAULT_SETTINGS.newPerDay,
    reviewsPerDay: config.rev?.perDay ?? DEFAULT_SETTINGS.reviewsPerDay,
    desiredRetention: config.desiredRetention ?? DEFAULT_SETTINGS.desiredRetention,
    maximumInterval: config.rev?.maxIvl ?? DEFAULT_SETTINGS.maximumInterval,
    learningSteps: (config.new?.delays ?? [1,10]).map(step),
    relearningSteps: (config.lapse?.delays ?? [10]).map(step),
    leechThreshold: config.lapse?.leechFails ?? DEFAULT_SETTINGS.leechThreshold,
    burySiblings: Boolean(config.new?.bury || config.rev?.bury),
    ...(weights?.length ? { fsrsWeights: weights } : {}),
  }
}

export interface MigrationReport {
  profile:string; decks:number; notes:number; cards:number; reviews:number; media:number
  missingMedia:string[]; sourceCounts:{notes:number;cards:number;reviews:number;media:number}
  compatibility:Array<{modelName:string;status:string;reason:string}>
}

export async function migrateFromAnki(): Promise<MigrationReport> {
  return Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const { staging } = yield* collectionImport
    const report = yield* withStagingDatabase(staging, targetDb => Effect.gen(function* () {
      createSchema(targetDb)
      targetDb.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL')
      const profile = yield* invokeEffect<string>('getActiveProfile')
      const decks = yield* invokeEffect<Record<string,number>>('deckNamesAndIds')
      const cardIds = yield* invokeEffect<number[]>('findCards', { query:'' })
      let cards:CardInfo[] = []
      for (const batch of chunks(cardIds)) cards.push(...yield* invokeEffect<CardInfo[]>('cardsInfo',{cards:batch}))
      const noteIds = [...new Set(cards.map((card)=>card.note))]
      let notes:NoteInfo[] = []
      for (const batch of chunks(noteIds)) notes.push(...yield* invokeEffect<NoteInfo[]>('notesInfo',{notes:batch}))
      const modelNames = [...new Set(notes.map((note)=>note.modelName))]
      const models = new Map<string,{fields:string[];templates:Record<string,{Front:string;Back:string}>}>()
      for (const name of modelNames) models.set(name, {
        fields: yield* invokeEffect<string[]>('modelFieldNames',{modelName:name}),
        templates: yield* invokeEffect<Record<string,{Front:string;Back:string}>>('modelTemplates',{modelName:name}),
      })
      const reviewMap = new Map<number,Review>()
      for (const deck of Object.keys(decks)) {
        for (const review of yield* invokeEffect<Review[]>('cardReviews',{deck,startID:0})) {
          reviewMap.set(Array.isArray(review) ? review[0] : review.id, review)
        }
      }
      const reviews = [...reviewMap.values()]
      const mediaNames = yield* invokeEffect<string[]>('getMediaFilesNames',{pattern:'*'})
      const deckSettings = new Map<string,SchedulingSettings>()
      for (const name of Object.keys(decks)) {
        const config = yield* invokeEffect<DeckConfig|false>('getDeckConfig', {deck:name}).pipe(Effect.catch(() => Effect.succeed(false as const)))
        deckSettings.set(name,scheduling(config))
      }

      const todayNumber = yield* schedulerDay(cards)
      const dayStart = new Date(); dayStart.setHours(0,0,0,0)
      const latestReview = new Map<number,number>()
      const cardIdSet = new Set(cardIds)
      const cardReviews = new Map<number,Array<{id:number;ease:number}>>()
      for (const review of reviews) {
        const id = Array.isArray(review) ? review[0] : review.id
        const cid = Array.isArray(review) ? review[1] : review.cid
        if (id > (latestReview.get(cid) ?? 0)) latestReview.set(cid,id)
        const ease=Array.isArray(review)?review[3]:review.ease
        if (ease>=1 && ease<=4) cardReviews.set(cid,[...(cardReviews.get(cid)??[]),{id,ease}])
      }
      const memories = new Map<number,{stability:number;difficulty:number}>()
      for (const card of cards) {
        const history=(cardReviews.get(card.cardId)??[]).sort((a,b)=>a.id-b.id)
        if (!history.length) continue
        const settings=deckSettings.get(card.deckName)??DEFAULT_SETTINGS
        const rebuilt=fsrs({request_retention:settings.desiredRetention,maximum_interval:settings.maximumInterval,
          learning_steps:settings.learningSteps,relearning_steps:settings.relearningSteps,...(settings.fsrsWeights?.length?{w:settings.fsrsWeights}:{})})
          .reschedule(createEmptyCard(new Date(history[0].id)),history.map((item)=>({rating:item.ease as 1|2|3|4,review:new Date(item.id)}))).collections.at(-1)?.card
        if (rebuilt?.stability && rebuilt.difficulty) memories.set(card.cardId,{stability:rebuilt.stability,difficulty:rebuilt.difficulty})
      }

      targetDb.transaction(() => {
        targetDb.query('INSERT INTO meta VALUES(?,?)').run('profile',profile)
        targetDb.query('INSERT INTO meta VALUES(?,?)').run('imported_at',new Date().toISOString())
        for (const [name,id] of Object.entries(decks)) targetDb.query('INSERT INTO decks VALUES(?,?)').run(id,name)
        for (const [name,model] of models) targetDb.query('INSERT INTO models VALUES(?,?,?)').run(name,JSON.stringify(model.fields),JSON.stringify(model.templates))
        for (const note of notes) targetDb.query('INSERT INTO notes VALUES(?,?,?,?)').run(note.noteId,note.modelName,JSON.stringify(note.fields),JSON.stringify(note.tags))
        for (const card of cards) {
          const memory=memories.get(card.cardId)
          const settings=deckSettings.get(card.deckName)??DEFAULT_SETTINGS
          const stepCount=card.type===3?settings.relearningSteps.length:settings.learningSteps.length
          const learningStep=card.type===1||card.type===3?Math.max(0,stepCount-card.left%1000):0
          const dueAt = card.queue===2 ? dayStart.getTime()+(card.due-(todayNumber ?? 0))*86400000
            : card.queue===1 || card.queue===3 ? card.due*1000 : card.due
          const buriedUntil = card.queue===-2 ? dayStart.getTime()+86400000 : null
          const queue = card.queue===-2 ? card.type : card.queue
          targetDb.query(`INSERT INTO cards(id,note_id,deck_name,ord,question,answer,interval,type,queue,due,due_at,reps,lapses,remaining,modified,flags,buried_until,leech,stability,difficulty,scheduled_days,learning_steps,last_review)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(card.cardId,card.note,card.deckName,card.ord,card.question,card.answer,card.interval,card.type,queue,card.due,dueAt,card.reps,card.lapses,card.left,card.mod,card.flags,buriedUntil,card.lapses>=8?1:0,memory?.stability??Math.max(.1,card.interval),memory?.difficulty??5.5,Math.max(0,card.interval),learningStep,latestReview.get(card.cardId)??null)
        }
        for (const review of reviews) {
          const values = Array.isArray(review) ? [review[0],review[1],review[3],review[4],review[5],review[7],review[8]]
            : [review.id,review.cid,review.ease,review.ivl,review.lastIvl,review.time,review.type]
          if (cardIdSet.has(values[1])) targetDb.query('INSERT OR IGNORE INTO revlog VALUES(?,?,?,?,?,?,?)').run(...(values as [number,number,number,number,number,number,number]))
        }
      })()

      for (const name of Object.keys(decks)) {
        targetDb.query('INSERT INTO settings VALUES(?,?)').run(name,JSON.stringify(deckSettings.get(name)))
        const reviewed = Number((targetDb.query(`SELECT COUNT(*) count FROM revlog r JOIN cards c ON c.id=r.card_id
          WHERE r.id>=? AND r.id<? AND r.kind=1 AND c.deck_name=?`).get(dayStart.getTime(),dayStart.getTime()+86400000,name) as {count:number}).count)
        if (reviewed) {
          const key = `${dayStart.getFullYear()}-${String(dayStart.getMonth()+1).padStart(2,'0')}-${String(dayStart.getDate()).padStart(2,'0')}`
          targetDb.query('INSERT INTO daily_activity VALUES(?,?,0,?)').run(key,name,reviewed)
        }
      }
      const missingMedia:string[] = []
      let importedMedia = 0
      for (const name of mediaNames) {
        const encoded = yield* invokeEffect<string|false>('retrieveMediaFile',{filename:name})
        if (!encoded) { missingMedia.push(name); continue }
        targetDb.query('INSERT INTO media VALUES(?,?)').run(name,Buffer.from(encoded,'base64'))
        importedMedia += 1
      }

      const counts = {
        notes: Number((targetDb.query('SELECT COUNT(*) n FROM notes').get() as {n:number}).n),
        cards: Number((targetDb.query('SELECT COUNT(*) n FROM cards').get() as {n:number}).n),
        reviews: Number((targetDb.query('SELECT COUNT(*) n FROM revlog').get() as {n:number}).n),
        media: Number((targetDb.query('SELECT COUNT(*) n FROM media').get() as {n:number}).n),
      }
      const detected = buildDeckConfig('Imported collection', modelNames.map((modelName) => ({
        modelName,
        fields: models.get(modelName)!.fields,
        templates: models.get(modelName)!.templates,
        templateCount: Object.keys(models.get(modelName)!.templates).length,
        noteCount: notes.filter((note) => note.modelName===modelName).length,
        samples: cards.filter((card) => card.modelName===modelName).slice(0,3).map((card) => ({...card,fieldOrder:0})),
      })))
      if (missingMedia.length) throw new Error(`Migration stopped because ${missingMedia.length} media files could not be copied. Nothing was replaced.`)
      validateCollection(targetDb, {notes:notes.length,cards:cards.length,reviews:reviews.length,media:mediaNames.length})
      return { profile,decks:Object.keys(decks).length,notes:counts.notes,cards:counts.cards,reviews:counts.reviews,media:counts.media,
        missingMedia,sourceCounts:{notes:notes.length,cards:cards.length,reviews:reviews.length,media:mediaNames.length},
        compatibility:detected.compatibility.map(({modelName,status,reason})=>({modelName,status,reason})) }
    }))
    activateCollection(staging)
    return report
  })))
}

if (import.meta.main) {
  const report = await migrateFromAnki()
  console.log(JSON.stringify(report,null,2))
}
