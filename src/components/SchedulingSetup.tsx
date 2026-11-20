import { Effect } from 'effect'
import { type QueryCache, querySource } from '@effectweb/query'
import { available, component, list, observe, resourceError, view } from 'effectweb'
import { api } from '../lib/api'
import type { SchedulingSettings } from '../lib/domain'
import { deckSettings, collectionBackups, saveDeckSettings } from '../lib/resources'
import { CollectionImportView } from './CollectionImport'

type Props = { cache: QueryCache; deckName: string; onClose: () => void; onSaved: () => void }

export const SchedulingSetup = component(
  {
    init: (_props: Props) => ({ error: '', saving: false, restoring: '' }),
    identity: (props) => props.deckName,
  },
  (owner) => {
    return view(({ props, error, saving, restoring }) =>
      observe(querySource(props.cache, deckSettings, props.deckName), (settings) => {
        const current = available(settings)
        if (!current)
          return (
            <p class="py-16 text-center font-bold">
              {resourceError(settings) ?? 'Loading scheduling settings...'}
            </p>
          )

        function submit(event: SubmitEvent) {
          event.preventDefault()
          const form = new FormData(event.currentTarget as HTMLFormElement)
          const steps = (name: string) =>
            String(form.get(name) ?? '')
              .split(/[ ,]+/)
              .map((item) => item.trim())
              .filter(Boolean) as SchedulingSettings['learningSteps']
          const value: SchedulingSettings = {
            ...current,
            newPerDay: Number(form.get('newPerDay')),
            reviewsPerDay: Number(form.get('reviewsPerDay')),
            desiredRetention: Number(form.get('desiredRetention')),
            maximumInterval: Number(form.get('maximumInterval')),
            learningSteps: steps('learningSteps'),
            relearningSteps: steps('relearningSteps'),
            leechThreshold: Number(form.get('leechThreshold')),
            burySiblings: form.get('burySiblings') === 'on',
          }
          owner.patch({ saving: true, error: '' })
          owner.run(
            'save',
            saveDeckSettings(props.cache, props.deckName, value).pipe(
              Effect.match({
                onSuccess: () => {
                  owner.patch({ saving: false })
                  props.onSaved()
                },
                onFailure: (error) => owner.patch({ saving: false, error: error.message }),
              }),
            ),
            'drop',
          )
        }

        function restore(name: string) {
          if (!confirm(`Restore ${name}? The current collection will be backed up first.`)) return
          owner.patch({ restoring: name, error: '' })
          owner.run(
            'restore',
            api.restoreBackup(name).pipe(
              Effect.match({
                onSuccess: () => window.location.assign('/'),
                onFailure: (error) => owner.patch({ restoring: '', error: error.message }),
              }),
            ),
            'drop',
          )
        }

        return (
          <form class="mx-auto max-w-3xl card-shell bg-white p-6 sm:p-8" onSubmit={submit}>
            <p class="eyebrow">{props.deckName}</p>
            <h1 class="mt-2 text-3xl font-black">Scheduling</h1>
            <p class="mt-2 text-sm text-[var(--muted)]">
              Again and Good remain the only grades. These settings control the queue around them.
            </p>
            <div class="mt-7 grid gap-5 sm:grid-cols-2">
              <NumberField
                name="newPerDay"
                label="New cards per day"
                value={current.newPerDay}
                min="0"
                step="1"
              />
              <NumberField
                name="reviewsPerDay"
                label="Reviews per day"
                value={current.reviewsPerDay}
                min="0"
                step="1"
              />
              <NumberField
                name="desiredRetention"
                label="Desired retention"
                value={current.desiredRetention}
                min="0.7"
                max="0.99"
                step="0.01"
              />
              <NumberField
                name="maximumInterval"
                label="Maximum interval, days"
                value={current.maximumInterval}
                min="1"
                step="1"
              />
              <TextField
                name="learningSteps"
                label="Learning steps"
                value={current.learningSteps.join(' ')}
              />
              <TextField
                name="relearningSteps"
                label="Relearning steps"
                value={current.relearningSteps.join(' ')}
              />
              <NumberField
                name="leechThreshold"
                label="Leech threshold"
                value={current.leechThreshold}
                min="1"
                step="1"
              />
              <label class="flex items-center gap-3 self-end rounded-xl border border-black/10 px-4 py-3 font-bold">
                <input type="checkbox" name="burySiblings" checked={current.burySiblings} /> Bury siblings
              </label>
            </div>
            <p class="mt-4 text-xs text-[var(--muted)]">Steps accept values such as 1m, 10m, 1h, or 1d.</p>
            {error ? (
              <p role="alert" class="mt-4 font-bold text-red-700">
                {error}
              </p>
            ) : null}
            <div class="mt-8 flex justify-end gap-3 border-t border-black/8 pt-6">
              <button type="button" class="button-quiet" onClick={props.onClose}>
                Cancel
              </button>
              <button type="submit" class="button-primary" disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
            <CollectionImportView />
            {observe(querySource(props.cache, collectionBackups), (result) => {
              const backups = available(result)
              return backups?.length ? (
                <section class="mt-8 border-t border-black/8 pt-6">
                  <h2 class="text-xl font-black">Backups</h2>
                  <p class="mt-1 text-sm text-[var(--muted)]">
                    Restore a collection saved before an earlier replacement.
                  </p>
                  <ul class="mt-4 space-y-2">
                    {list(backups, (name) => (
                      <li class="flex items-center justify-between gap-3 rounded-xl border border-black/10 p-3">
                        <span class="min-w-0 truncate text-sm font-semibold">{name}</span>
                        <button
                          type="button"
                          class="button-quiet"
                          disabled={Boolean(restoring)}
                          onClick={() => restore(name)}
                        >
                          {restoring === name ? 'Restoring...' : 'Restore'}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null
            })}
          </form>
        )
      }),
    )
  },
)

const NumberField = view<{
  name: string
  label: string
  value: number
  min: string
  max?: string
  step: string
}>((props) => {
  return (
    <label class="grid gap-2 text-sm font-bold">
      {props.label}
      <input
        class="rounded-xl border border-black/12 px-4 py-3"
        type="number"
        name={props.name}
        value={props.value}
        min={props.min}
        max={props.max}
        step={props.step}
        required
      />
    </label>
  )
})
const TextField = view<{ name: string; label: string; value: string }>((props) => {
  return (
    <label class="grid gap-2 text-sm font-bold">
      {props.label}
      <input class="rounded-xl border border-black/12 px-4 py-3" name={props.name} value={props.value} />
    </label>
  )
})
