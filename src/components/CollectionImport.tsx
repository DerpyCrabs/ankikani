import { createSignal, For, Show } from 'solid-js'
import type { PackageImportReport } from '../lib/api'
import { useMutation } from '@tanstack/solid-query'
import { mutations } from '../lib/query'

export function CollectionImport(props:{ compact?:boolean }) {
  const [error,setError] = createSignal('')
  const [importing,setImporting] = createSignal(false)
  const [report,setReport] = createSignal<PackageImportReport|null>(null)
  const importPackage = useMutation(() => mutations.importPackage())
  let input:HTMLInputElement|undefined

  async function run() {
    const file = input?.files?.[0]
    if (!file) { setError('Choose an .apkg or .colpkg file.'); return }
    const question = props.compact
      ? `Import ${file.name} as your local collection?`
      : `Replace the local collection with ${file.name}? A database backup will be created first.`
    if (!confirm(question)) return
    setImporting(true); setError('')
    try { setReport(await importPackage.mutateAsync(file)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not import package.') }
    finally { setImporting(false) }
  }

  return <section class={props.compact ? '' : 'mt-8 border-t border-black/8 pt-6'}>
    <h2 class="text-xl font-black">{props.compact ? 'Import your Anki collection' : 'Replace collection'}</h2>
    <p class="mt-1 text-sm text-[var(--muted)]">Import an .apkg deck or .colpkg collection directly. Anki Desktop is not required. Existing local reviews are replaced only after validation.</p>
    <Show when={!report()}>
      <div class="mt-4 flex flex-wrap items-center gap-3">
        <input ref={input} aria-label="Anki package" type="file" accept=".apkg,.colpkg" disabled={importing()} class="min-w-0 flex-1 rounded-xl border border-black/12 px-4 py-3" />
        <button type="button" class="button-quiet" disabled={importing()} onClick={run}>{importing() ? 'Importing and validating...' : 'Import package'}</button>
      </div>
      <Show when={importing()}><p class="mt-3 text-sm font-semibold" role="status">Keep this page open. Large collections can take several minutes.</p></Show>
    </Show>
    <Show when={error()}><p role="alert" class="mt-4 font-bold text-red-700">{error()}</p></Show>
    <Show when={report()}>{(value) => <div class="mt-4 rounded-xl border border-green-700/25 bg-green-50 p-4">
      <p class="font-black">Import validated</p>
      <p class="mt-1 text-sm">{value().notes} notes, {value().cards} cards, {value().reviews} reviews, and {value().media} media files imported.</p>
      <Show when={value().compatibility.length}><ul class="mt-3 space-y-1 text-sm"><For each={value().compatibility}>{(item)=><li><strong>{item.modelName}:</strong> {item.status}. {item.reason}</li>}</For></ul></Show>
      <Show when={value().backup}><p class="mt-3 break-all text-xs text-[var(--muted)]">Backup: {value().backup}</p></Show>
      <button type="button" class="button-primary mt-4" onClick={()=>window.location.assign('/')}>Open collection</button>
    </div>}</Show>
  </section>
}
