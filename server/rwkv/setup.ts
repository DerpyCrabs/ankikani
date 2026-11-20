import { mkdir, rename } from 'node:fs/promises'
import path from 'node:path'

const directory = path.join(process.env.ANKIKANI_DATA_DIR ?? path.resolve(import.meta.dir, '../../data'), 'rwkv')
await mkdir(directory, { recursive: true })
const reference = path.join(directory, 'reference')

async function run(args: string[], cwd = directory) {
  const process = Bun.spawn(args, { cwd, stdout: 'inherit', stderr: 'inherit' })
  if (await process.exited !== 0) throw new Error(`Failed to run ${args[0]}`)
}

if (!await Bun.file(path.join(reference, '.git/HEAD')).exists()) {
  await run(['git', 'clone', '--filter=blob:none', '--no-checkout', 'https://github.com/JSchoreels/anki-rwkv', reference])
}
await run(['git', 'sparse-checkout', 'set', 'rwkv', 'features', 'expertium'], reference)
await run(['git', 'checkout', 'c22a304b7ff9332183efdca71ffcc4e60637da34'], reference)
await run(['uv', 'sync', '--locked', '--python', '3.12'], reference)
const weights = path.join(directory, 'model.pth')
const digest = '82d60a4de2e26b4064b86359874e458d1546c0e9651c5dbdf9b8f449a9b97114'
if (!await Bun.file(weights).exists() || new Bun.CryptoHasher('sha256').update(await Bun.file(weights).arrayBuffer()).digest('hex') !== digest) {
  const response = await fetch('https://raw.githubusercontent.com/open-spaced-repetition/srs-benchmark/57c0b0700c8a63cc7b68ffb9c8270271db8fd021/pretrain/RWKV_trained_on_101_4999.pth')
  if (!response.ok) throw new Error(`Checkpoint download failed (${response.status})`)
  const bytes = await response.arrayBuffer()
  if (new Bun.CryptoHasher('sha256').update(bytes).digest('hex') !== digest) throw new Error('Unexpected RWKV weights')
  await Bun.write(weights + '.tmp', bytes)
  await rename(weights + '.tmp', weights)
}
