import { Effect } from 'effect'
import { Database } from 'bun:sqlite'
import { closeSync, copyFileSync, existsSync, openSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { closeCollection, collectionPath } from './owned'

export type CollectionCounts = { notes:number; cards:number; reviews:number; media:number }

const stagingPath = () => `${collectionPath()}.importing`
const lockPath = () => `${collectionPath()}.import.lock`

export function beginCollectionImport() {
  const token=`${process.pid}-${randomUUID()}`
  let lock:number
  try { lock=openSync(lockPath(),'wx') }
  catch (error) {
    const failure=error as NodeJS.ErrnoException
    if (failure.code!=='EEXIST') throw error
    let active=true
    try {
      const stored=JSON.parse(readFileSync(lockPath(),'utf8')) as {pid?:number}
      if (stored.pid) try { process.kill(stored.pid,0) } catch (cause) { if ((cause as NodeJS.ErrnoException).code==='ESRCH') active=false }
      else active=Date.now()-statSync(lockPath()).mtimeMs<30_000
    } catch { active=Date.now()-statSync(lockPath()).mtimeMs<30_000 }
    if (active) throw new Error('Another collection import is already running.')
    unlinkSync(lockPath())
    lock=openSync(lockPath(),'wx')
  }
  writeFileSync(lock,JSON.stringify({pid:process.pid,token,startedAt:new Date().toISOString()}))
  const staging = stagingPath()
  if (existsSync(staging)) unlinkSync(staging)
  return { staging, release: () => {
    closeSync(lock)
    if (existsSync(staging)) unlinkSync(staging)
    if (existsSync(lockPath())) {
      try { if ((JSON.parse(readFileSync(lockPath(),'utf8')) as {token?:string}).token===token) unlinkSync(lockPath()) } catch {}
    }
  } }
}

// Keep the import lock until activation finishes. Close the staging database before renaming it.
export const collectionImport = Effect.acquireRelease(
  Effect.sync(beginCollectionImport),
  state => Effect.sync(state.release),
)

export function withStagingDatabase<A, E, R>(staging: string, write: (db: Database) => Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => new Database(staging, { create: true })),
    write,
    db => Effect.sync(() => db.close()),
  )
}

export function validateCollection(target:Database, expected:CollectionCounts) {
  const count = (table:string) => Number((target.query(`SELECT COUNT(*) count FROM ${table}`).get() as {count:number}).count)
  const actual = { notes:count('notes'), cards:count('cards'), reviews:count('revlog'), media:count('media') }
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Import validation failed: expected ${JSON.stringify(expected)}, stored ${JSON.stringify(actual)}.`)
  const integrity = target.query('PRAGMA integrity_check').get() as {integrity_check:string}
  if (integrity.integrity_check !== 'ok') throw new Error(`Import validation failed: ${integrity.integrity_check}`)
  const foreignKeys = target.query('PRAGMA foreign_key_check').all()
  if (foreignKeys.length) throw new Error(`Import validation failed: ${foreignKeys.length} broken references.`)
}

export function activateCollection(staging:string) {
  const target = collectionPath()
  closeCollection()
  let backup:string|null = null
  if (existsSync(target)) {
    backup = path.join(path.dirname(target), `ankikani-before-import-${new Date().toISOString().replaceAll(':','-').replaceAll('.','-')}.sqlite`)
    copyFileSync(target, backup)
  }
  for (const sidecar of [`${target}-wal`,`${target}-shm`]) if (existsSync(sidecar)) unlinkSync(sidecar)
  try { renameSync(staging, target) }
  catch (error) {
    if (!existsSync(target) && backup) copyFileSync(backup, target)
    throw error
  }
  return backup
}

export function listCollectionBackups() {
  const directory = path.dirname(collectionPath())
  return readdirSync(directory).filter((name) => /^ankikani-(?:before-import-)?[\w.-]+\.sqlite$/.test(name)).sort().reverse()
}

export function restoreCollectionBackup(name:string) {
  if (!listCollectionBackups().includes(name)) throw new Error('Backup not found.')
  const state = beginCollectionImport()
  try {
    copyFileSync(path.join(path.dirname(collectionPath()),name),state.staging)
    const check = new Database(state.staging,{readonly:true})
    try {
      const count = (table:string) => Number((check.query(`SELECT COUNT(*) count FROM ${table}`).get() as {count:number}).count)
      validateCollection(check,{notes:count('notes'),cards:count('cards'),reviews:count('revlog'),media:count('media')})
    } finally { check.close() }
    return activateCollection(state.staging)
  } finally { state.release() }
}
