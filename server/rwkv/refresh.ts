import { existsSync } from 'node:fs'
import path from 'node:path'

let lastRefresh = 0
let running = false

export function rwkvAvailable(collection: string) {
  const runtime = path.join(path.dirname(collection), 'rwkv')
  return existsSync(path.join(runtime, 'reference/.venv/bin/python')) && existsSync(path.join(runtime, 'model.pth'))
}

export function refreshReviewScores(collection: string) {
  const runtime = path.join(path.dirname(collection), 'rwkv')
  const reference = path.join(runtime, 'reference')
  const python = path.join(reference, '.venv/bin/python')
  if (running || Date.now() - lastRefresh < 3600000 || !existsSync(python)) return
  const weights = path.join(runtime, 'model.pth')
  if (!existsSync(weights)) return
  lastRefresh = Date.now()
  try {
    const worker = Bun.spawn([python, path.join(import.meta.dir, 'rank.py'), weights, collection], {
      env: { ...process.env, PYTHONPATH: reference },
      stdout: 'ignore', stderr: 'inherit',
    })
    running = true
    void worker.exited.then(code => {
      running = false
      if (code !== 0) console.error('RWKV review score refresh failed', code)
    })
  } catch (error) {
    console.error('Could not start RWKV review scoring', error)
  }
}
