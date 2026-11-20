import { createSignal, For, Show } from 'solid-js'
import { useMutation, useQuery, useQueryClient } from '@tanstack/solid-query'
import type { SchedulingSettings } from '../lib/domain'
import { CollectionImport } from './CollectionImport'
import { mutations, queries } from '../lib/query'

export function SchedulingSetup(props: { deckName:string; onClose:()=>void; onSaved:()=>void }) {
  const client = useQueryClient()
  const settings = useQuery(() => queries.settings(props.deckName))
  const backups = useQuery(() => queries.backups())
  const saveSettings = useMutation(() => mutations.updateSettings(client,props.deckName))
  const restoreCollection = useMutation(() => mutations.restoreBackup())
  const [error,setError] = createSignal('')
  const [saving,setSaving] = createSignal(false)
  const [restoring,setRestoring] = createSignal('')

  async function submit(event:SubmitEvent) {
    event.preventDefault()
    const form = new FormData(event.currentTarget as HTMLFormElement)
    const current = settings.data
    if (!current) return
    const steps = (name:string) => String(form.get(name) ?? '').split(/[ ,]+/).map((item)=>item.trim()).filter(Boolean) as SchedulingSettings['learningSteps']
    const value:SchedulingSettings = {
      ...current,
      newPerDay:Number(form.get('newPerDay')),
      reviewsPerDay:Number(form.get('reviewsPerDay')),
      desiredRetention:Number(form.get('desiredRetention')),
      maximumInterval:Number(form.get('maximumInterval')),
      learningSteps:steps('learningSteps'),
      relearningSteps:steps('relearningSteps'),
      leechThreshold:Number(form.get('leechThreshold')),
      burySiblings:form.get('burySiblings') === 'on',
    }
    setSaving(true); setError('')
    try { await saveSettings.mutateAsync(value); props.onSaved() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save scheduling settings.') }
    finally { setSaving(false) }
  }

  async function restore(name:string) {
    if (!confirm(`Restore ${name}? The current collection will be backed up first.`)) return
    setRestoring(name); setError('')
    try { await restoreCollection.mutateAsync(name); window.location.assign('/') }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not restore backup.') }
    finally { setRestoring('') }
  }

  return <Show when={settings.data} fallback={<p class="py-16 text-center font-bold">{settings.error instanceof Error ? settings.error.message : 'Loading scheduling settings...'}</p>}>
    {(value) => <form class="mx-auto max-w-3xl card-shell bg-white p-6 sm:p-8" onSubmit={submit}>
      <p class="eyebrow">{props.deckName}</p>
      <h1 class="mt-2 text-3xl font-black">Scheduling</h1>
      <p class="mt-2 text-sm text-[var(--muted)]">Again and Good remain the only grades. These settings control the queue around them.</p>
      <div class="mt-7 grid gap-5 sm:grid-cols-2">
        <NumberField name="newPerDay" label="New cards per day" value={value().newPerDay} min="0" step="1" />
        <NumberField name="reviewsPerDay" label="Reviews per day" value={value().reviewsPerDay} min="0" step="1" />
        <NumberField name="desiredRetention" label="Desired retention" value={value().desiredRetention} min="0.7" max="0.99" step="0.01" />
        <NumberField name="maximumInterval" label="Maximum interval, days" value={value().maximumInterval} min="1" step="1" />
        <TextField name="learningSteps" label="Learning steps" value={value().learningSteps.join(' ')} />
        <TextField name="relearningSteps" label="Relearning steps" value={value().relearningSteps.join(' ')} />
        <NumberField name="leechThreshold" label="Leech threshold" value={value().leechThreshold} min="1" step="1" />
        <label class="flex items-center gap-3 self-end rounded-xl border border-black/10 px-4 py-3 font-bold">
          <input type="checkbox" name="burySiblings" checked={value().burySiblings} /> Bury siblings
        </label>
      </div>
      <p class="mt-4 text-xs text-[var(--muted)]">Steps accept values such as 1m, 10m, 1h, or 1d.</p>
      <Show when={error()}><p role="alert" class="mt-4 font-bold text-red-700">{error()}</p></Show>
      <div class="mt-8 flex justify-end gap-3 border-t border-black/8 pt-6">
        <button type="button" class="button-quiet" onClick={props.onClose}>Cancel</button>
        <button type="submit" class="button-primary" disabled={saving()}>{saving() ? 'Saving...' : 'Save'}</button>
      </div>
      <CollectionImport />
      <Show when={backups.data?.length}>
        <section class="mt-8 border-t border-black/8 pt-6">
          <h2 class="text-xl font-black">Backups</h2>
          <p class="mt-1 text-sm text-[var(--muted)]">Restore a collection saved before an earlier replacement.</p>
          <ul class="mt-4 space-y-2"><For each={backups.data}>{(name)=><li class="flex items-center justify-between gap-3 rounded-xl border border-black/10 p-3">
            <span class="min-w-0 truncate text-sm font-semibold">{name}</span>
            <button type="button" class="button-quiet" disabled={Boolean(restoring())} onClick={()=>restore(name)}>{restoring()===name?'Restoring...':'Restore'}</button>
          </li>}</For></ul>
        </section>
      </Show>
    </form>}
  </Show>
}

function NumberField(props:{name:string;label:string;value:number;min:string;max?:string;step:string}) {
  return <label class="grid gap-2 text-sm font-bold">{props.label}<input class="rounded-xl border border-black/12 px-4 py-3" type="number" name={props.name} value={props.value} min={props.min} max={props.max} step={props.step} required /></label>
}
function TextField(props:{name:string;label:string;value:string}) {
  return <label class="grid gap-2 text-sm font-bold">{props.label}<input class="rounded-xl border border-black/12 px-4 py-3" name={props.name} value={props.value} /></label>
}
