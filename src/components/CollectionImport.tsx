import { Effect } from 'effect'
import { component, list, view } from 'effectweb'
import { api, type PackageImportReport } from '../lib/api'

type ImportState = {
  file: File | null
  error: string
  importing: boolean
  report: PackageImportReport | null
}

export const CollectionImportView = component(
  {
    init: (_props: { compact?: boolean }): ImportState => ({
      file: null,
      error: '',
      importing: false,
      report: null,
    }),
  },
  (owner) =>
    view(({ props, file, importing, error, report }) => {
      function run() {
        if (!file) {
          owner.patch({ error: 'Choose an .apkg or .colpkg file.' })
          return
        }
        const question = props.compact
          ? `Import ${file.name} as your local collection?`
          : `Replace the local collection with ${file.name}? A database backup will be created first.`
        if (!confirm(question)) return
        owner.patch({ importing: true, error: '' })
        owner.run(
          'import',
          api.importPackage(file).pipe(
            Effect.match({
              onSuccess: (result) => owner.patch({ report: result, importing: false }),
              onFailure: (message) => owner.patch({ error: message.message, importing: false }),
            }),
          ),
          'drop',
        )
      }

      return (
        <section class={props.compact ? '' : 'mt-8 border-t border-black/8 pt-6'}>
          <h2 class="text-xl font-black">
            {props.compact ? 'Import your Anki collection' : 'Replace collection'}
          </h2>
          <p class="mt-1 text-sm text-[var(--muted)]">
            Import an .apkg deck or .colpkg collection directly. Anki Desktop is not required. Existing local
            reviews are replaced only after validation.
          </p>
          {!report && (
            <div class="mt-4 flex flex-wrap items-center gap-3">
              <input
                aria-label="Anki package"
                type="file"
                accept=".apkg,.colpkg"
                disabled={importing}
                onChange={(event) => owner.patch({ file: event.currentTarget.files?.[0] ?? null })}
                class="min-w-0 flex-1 rounded-xl border border-black/12 px-4 py-3"
              />
              <button type="button" class="button-quiet" disabled={importing} onClick={run}>
                {importing ? 'Importing and validating...' : 'Import package'}
              </button>
            </div>
          )}
          {importing && (
            <p class="mt-3 text-sm font-semibold" role="status">
              Keep this page open. Large collections can take several minutes.
            </p>
          )}
          {error && (
            <p role="alert" class="mt-4 font-bold text-red-700">
              {error}
            </p>
          )}
          {report && (
            <div class="mt-4 rounded-xl border border-green-700/25 bg-green-50 p-4">
              <p class="font-black">Import validated</p>
              <p class="mt-1 text-sm">
                {report.notes} notes, {report.cards} cards, {report.reviews} reviews, and {report.media} media
                files imported.
              </p>
              <p class="mt-2 text-sm font-semibold">
                {report.studyCards} of {report.cards} cards have a study prompt and answer with automatic field mapping.
              </p>
              {report.compatibility.length > 0 && (
                <ul class="mt-3 space-y-1 text-sm">
                  {list(
                    report.compatibility,
                    (item) => item.modelName,
                    (item) => (
                      <li>
                        <strong>{item.modelName}:</strong> {item.status}. {item.reason}
                      </li>
                    ),
                  )}
                </ul>
              )}
              {report.backup && (
                <p class="mt-3 break-all text-xs text-[var(--muted)]">Backup: {report.backup}</p>
              )}
              <button type="button" class="button-primary mt-4" onClick={() => window.location.assign('/')}>
                Open collection
              </button>
            </div>
          )}
        </section>
      )
    }),
)
