import Check from '@effectweb/lucide/icons/check'
import ChevronRight from '@effectweb/lucide/icons/chevron-right'
import { component, list, view } from 'effectweb'
import { adaptCard, configFromLegacy } from '../lib/adapters'
import type {
  AnswerLanguage,
  AnswerMode,
  DeckConfig,
  DeckProfile,
  ModelConfig,
  StudyCard,
} from '../lib/domain'

type Props = {
  profile: DeckProfile
  existing: DeckConfig | null
  onSave: (configuration: DeckConfig) => void
  onCancel?: () => void
}

function initialFields(props: Props) {
  const fallback = (): DeckConfig => {
    if (props.profile.suggestedMapping) {
      return configFromLegacy(props.profile.deckName, props.profile.suggestedMapping)
    }
    return {
      version: 2,
      deckName: props.profile.deckName,
      includeSubdecks: true,
      models: props.profile.modelNames.map((modelName) => {
        const fields = props.profile.fieldsByModel[modelName] ?? []
        return {
          modelName,
          enabled: fields.length >= 2,
          kind: 'text',
          label: 'Typed recall',
          confidence: fields.length >= 2 ? 0.5 : 0,
          plans: [
            {
              ord: 0,
              kind: 'text',
              direction: 'forward',
              directionLabel: `${fields[0] ?? 'Prompt'} → ${fields[1] ?? 'Answer'}`,
              promptField: fields[0],
              answerFields: fields[1] ? [fields[1]] : [],
              answerLanguages: ['plain'],
            },
          ],
        } satisfies ModelConfig
      }),
    }
  }
  const initial = props.existing ?? props.profile.suggestedConfig ?? fallback()
  return {
    models: structuredClone(initial.models),
    modelName: initial.models[0]?.modelName ?? '',
    previewIndex: 0,
  }
}

export const DeckSetup = component(
  { init: initialFields, identity: (props) => props.profile.deckName },
  (owner) =>
    view(({ props, models, modelName, previewIndex }) => {
      const compatibility = (modelName: string) =>
        props.profile.compatibility?.find((item) => item.modelName === modelName)

      function updateModel(index: number, update: (model: ModelConfig) => void) {
        owner.patch({
          models: owner.read().models.map((model, modelIndex) => {
            if (modelIndex !== index) return model
            const next = structuredClone(model)
            update(next)
            return next
          }),
        })
      }
      const setModelName = (name: string) => {
        if (name !== modelName) owner.patch({ modelName: name, previewIndex: 0 })
      }
      const selectedIndex = Math.max(
        0,
        models.findIndex((model) => model.modelName === modelName),
      )
      const selectedModel = models[selectedIndex]
      const selectedReport = compatibility(modelName)
      const diagnostics = selectedReport?.diagnostics
      const fields = props.profile.fieldsByModel[modelName] ?? []
      const templateNames = Object.keys(props.profile.templatesByModel[modelName] ?? {})
      const previews = (() => {
        const selected = selectedModel
        if (!selected) return []
        const configuration: DeckConfig = {
          version: 2,
          deckName: props.profile.deckName,
          includeSubdecks: true,
          models: [selected],
        }
        return (props.profile.samplesByModel?.[modelName] ?? [])
          .map((card) => adaptCard(card, configuration))
          .filter((card): card is StudyCard => Boolean(card))
      })()
      const preview = previews[previewIndex] ?? previews[0]
      const setupIssues = (() => {
        const issues = [...(diagnostics?.issues ?? [])]
        const item = preview
        if (!item) issues.push('No sample produces a usable typed answer.')
        if (item?.prompt && item.prompt === item.canonicalAnswer) {
          issues.push('Prompt and answer are identical.')
        }
        return [...new Set(issues)]
      })()
      const firstPlan = selectedModel?.plans[0]
      const secondPlan = selectedModel?.plans[1] ?? firstPlan
      const sourceWord = firstPlan?.promptField ?? ''
      const targetMeaning = firstPlan?.answerFields[0] ?? ''
      const additionalAnswer = firstPlan?.answerFields[1] ?? ''
      const answerMode = firstPlan?.answerMode ?? 'parts'
      const answerSeparators = (firstPlan?.answerSeparators ?? ['/', ';']).join('')
      const additionalOptional = Boolean(
        additionalAnswer && firstPlan?.optionalAnswerFields?.includes(additionalAnswer),
      )
      const sourceLanguage = secondPlan?.answerLanguages[0] ?? 'plain'
      const targetLanguage = firstPlan?.answerLanguages[0] ?? 'plain'
      const sourceExample = firstPlan?.sourceExampleField ?? ''
      const targetExample = firstPlan?.targetExampleField ?? ''
      const note = firstPlan?.noteField ?? ''
      const audio = firstPlan?.audioField ?? ''
      const forwardOrd = firstPlan?.ord ?? 0
      const reverseOrd = secondPlan?.ord ?? 0
      const updatePlan = (planIndex: number, update: (plan: ModelConfig['plans'][number]) => void) =>
        updateModel(selectedIndex, (model) => {
          const selected = model.plans[planIndex] ?? model.plans[0]
          if (selected) update(selected)
        })
      const setSourceWord = (value: string) =>
        updateModel(selectedIndex, (model) => {
          model.plans.forEach((plan, index) => {
            if (index === 0) plan.promptField = value
            else plan.answerFields = [value]
          })
        })
      const setTargetMeaning = (value: string) =>
        updateModel(selectedIndex, (model) => {
          model.plans.forEach((plan, index) => {
            if (index === 0) {
              plan.answerFields = [value, ...plan.answerFields.slice(1)]
            } else plan.promptField = value
          })
        })
      const setAdditionalAnswer = (value: string) =>
        updatePlan(0, (plan) => {
          plan.answerFields = value
            ? [plan.answerFields[0], value].filter(Boolean)
            : plan.answerFields.slice(0, 1)
          plan.answerLanguages = value
            ? [plan.answerLanguages[0] ?? 'plain', plan.answerLanguages[1] ?? 'plain']
            : plan.answerLanguages.slice(0, 1)
          plan.optionalAnswerFields = (plan.optionalAnswerFields ?? []).filter((name) => name === value)
        })
      const setAnswerMode = (value: AnswerMode) =>
        updatePlan(0, (plan) => {
          plan.answerMode = value
        })
      const setAnswerSeparators = (value: string) =>
        updatePlan(0, (plan) => {
          plan.answerSeparators = [...new Set([...value])].filter((separator) => !/\s/u.test(separator))
        })
      const setAdditionalOptional = (optional: boolean) =>
        updatePlan(0, (plan) => {
          const fieldName = plan.answerFields[1]
          plan.optionalAnswerFields = optional && fieldName ? [fieldName] : []
        })
      const setSourceLanguage = (value: AnswerLanguage) =>
        updateModel(selectedIndex, (model) => {
          model.plans.slice(1).forEach((plan) => {
            plan.answerLanguages = [value]
          })
        })
      const setTargetLanguage = (value: AnswerLanguage) =>
        updatePlan(0, (plan) => {
          plan.answerLanguages = [value, ...plan.answerLanguages.slice(1)]
        })
      const setSourceExample = (value: string) =>
        updateModel(selectedIndex, (model) => {
          model.plans.forEach((plan) => {
            plan.sourceExampleField = value || undefined
          })
        })
      const setTargetExample = (value: string) =>
        updateModel(selectedIndex, (model) => {
          model.plans.forEach((plan) => {
            plan.targetExampleField = value || undefined
          })
        })
      const setNote = (value: string) =>
        updateModel(selectedIndex, (model) => {
          model.plans.forEach((plan) => {
            plan.noteField = value || undefined
          })
        })
      const setAudio = (value: string) =>
        updateModel(selectedIndex, (model) => {
          model.plans.forEach((plan) => {
            plan.audioField = value || undefined
          })
        })
      const setForwardOrd = (value: number) =>
        updatePlan(0, (plan) => {
          plan.ord = value
        })
      const setReverseOrd = (value: number) =>
        updateModel(selectedIndex, (model) => {
          if (model.plans[1]) model.plans[1].ord = value
        })

      function submit(event: SubmitEvent) {
        event.preventDefault()
        props.onSave({
          version: 2,
          deckName: props.profile.deckName,
          includeSubdecks: true,
          customized: true,
          models: models,
        })
      }

      return (
        <section class="mx-auto max-w-4xl">
          <div class="mb-7">
            <h1 class="text-3xl font-black tracking-[-0.04em]">Deck setup</h1>
            <p class="mt-2 text-[var(--muted)]">
              {models.filter((model) => model.enabled).length} of {models.length} note types enabled
            </p>
          </div>
          <form class="card-shell p-6 sm:p-8" onSubmit={submit}>
            <div class="mb-7 grid gap-3 sm:grid-cols-2">
              {list(
                models,
                (model) => model.modelName,
                (model, index) => {
                  const report = compatibility(model.modelName)
                  return (
                    <label
                      class="flex min-w-0 cursor-pointer items-start gap-3 rounded-xl border border-black/8 p-4"
                      onClick={() => setModelName(model.modelName)}
                    >
                      <input
                        class="mt-0.5 size-5 accent-[var(--violet)]"
                        type="checkbox"
                        checked={model.enabled}
                        onChange={(event) =>
                          updateModel(index, (next) => {
                            next.enabled = event.currentTarget.checked
                          })
                        }
                      />
                      <span class="min-w-0 flex-1">
                        <span class="flex items-center justify-between gap-2">
                          <span class="block min-w-0 flex-1 truncate font-black">{model.modelName}</span>
                          {report ? (
                            <span
                              class={`shrink-0 rounded-full px-2 py-0.5 text-[0.68rem] font-black uppercase tracking-[0.08em] ${
                                report?.status === 'ready'
                                  ? 'bg-[var(--mint-soft)] text-[var(--mint-dark)]'
                                  : report?.status === 'review'
                                    ? 'bg-[var(--yellow-soft)] text-[var(--ink)]'
                                    : 'bg-[var(--coral-soft)] text-[var(--coral-dark)]'
                              }`}
                            >
                              {report?.status === 'ready'
                                ? 'Ready'
                                : report?.status === 'review'
                                  ? 'Check'
                                  : 'Unsupported'}
                            </span>
                          ) : null}
                        </span>
                        <span class="mt-1 block text-sm text-[var(--muted)]">
                          {model.label}
                          {report ? <> · {report?.noteCount} notes</> : null}
                        </span>
                      </span>
                    </label>
                  )
                },
              )}
            </div>
            {selectedReport ? (
              <div
                class={`mb-6 rounded-2xl p-4 text-sm ${
                  selectedReport.status === 'ready'
                    ? 'bg-[var(--mint-soft)]'
                    : selectedReport.status === 'review'
                      ? 'bg-[var(--yellow-soft)]'
                      : 'bg-[var(--coral-soft)]'
                }`}
                role="status"
              >
                <strong>
                  {selectedReport.status === 'ready'
                    ? 'Ready to study.'
                    : selectedReport.status === 'review'
                      ? 'Check this mapping.'
                      : 'Setup required.'}
                </strong>
                <span class="ml-1 text-[var(--muted)]">{selectedReport.reason}</span>
              </div>
            ) : null}
            {preview ? (
              <div class="mb-6 rounded-2xl bg-[var(--mint-soft)] p-5">
                <div class="flex items-center justify-between gap-3">
                  <p class="text-xs font-black text-[var(--muted)]">
                    Preview {previewIndex + 1} of {previews.length}
                  </p>
                  {previews.length > 1 ? (
                    <div class="flex gap-2">
                      <button
                        type="button"
                        class="icon-button size-9"
                        aria-label="Previous preview"
                        onClick={() =>
                          owner.patch({
                            previewIndex: (previewIndex - 1 + previews.length) % previews.length,
                          })
                        }
                      >
                        <ChevronRight class="size-4 rotate-180" />
                      </button>
                      <button
                        type="button"
                        class="icon-button size-9"
                        aria-label="Next preview"
                        onClick={() => owner.patch({ previewIndex: (previewIndex + 1) % previews.length })}
                      >
                        <ChevronRight class="size-4" />
                      </button>
                    </div>
                  ) : null}
                </div>
                <p class="mt-3 font-black">{preview.prompt || 'Media prompt'}</p>
                <p class="mt-1 text-[var(--muted)]">{preview.canonicalAnswer}</p>
              </div>
            ) : null}
            {setupIssues.length ? (
              <div class="mb-6 rounded-2xl bg-[var(--coral-soft)] p-4 text-sm">
                {list(setupIssues, (issue) => (
                  <p class="font-semibold">{issue}</p>
                ))}
              </div>
            ) : null}
            {diagnostics ? (
              <details class="mb-6 rounded-2xl border border-black/8 bg-white p-4 text-sm">
                <summary class="cursor-pointer font-black">Detection details</summary>
                <div class="mt-3 space-y-2 text-[var(--muted)]">
                  <p>
                    <strong class="text-[var(--ink)]">Templates:</strong>{' '}
                    {diagnostics.templates.join(', ') || 'none'}
                  </p>
                  <p>
                    <strong class="text-[var(--ink)]">Prompt:</strong>{' '}
                    {diagnostics.promptFields.join(', ') || 'not detected'}
                  </p>
                  <p>
                    <strong class="text-[var(--ink)]">Answer:</strong>{' '}
                    {diagnostics.answerFields.join(', ') || 'not detected'}
                  </p>
                  <p>
                    <strong class="text-[var(--ink)]">Media:</strong>{' '}
                    {diagnostics.mediaFields.join(', ') || 'none'}
                  </p>
                </div>
              </details>
            ) : null}
            {selectedReport?.status !== 'ready' ? (
              <div class="grid gap-5 sm:grid-cols-2">
                <FieldSelect
                  label="Note type"
                  value={modelName}
                  options={props.profile.modelNames}
                  onInput={setModelName}
                />
                <div />
                <FieldSelect
                  label="Prompt"
                  value={sourceWord}
                  options={fields}
                  onInput={setSourceWord}
                  required
                />
                <FieldSelect
                  label="Answer"
                  value={targetMeaning}
                  options={fields}
                  onInput={setTargetMeaning}
                  required
                />
                <FieldSelect
                  label="Additional answer"
                  value={additionalAnswer}
                  options={fields}
                  onInput={setAdditionalAnswer}
                  optional
                />
                <AnswerModeSelect value={answerMode} onInput={setAnswerMode} />
                <LanguageSelect label="Prompt language" value={sourceLanguage} onInput={setSourceLanguage} />
                <LanguageSelect label="Answer language" value={targetLanguage} onInput={setTargetLanguage} />
                <label class="block">
                  <span class="field-label">Accepted separators</span>
                  <input
                    class="field-control"
                    value={answerSeparators}
                    onInput={(event) => setAnswerSeparators(event.currentTarget.value)}
                    aria-label="Accepted separators"
                  />
                </label>
                {additionalAnswer ? (
                  <label class="flex items-center gap-3 self-end rounded-xl border border-black/8 px-4 py-3">
                    <input
                      type="checkbox"
                      class="size-5 accent-[var(--violet)]"
                      checked={additionalOptional}
                      onChange={(event) => setAdditionalOptional(event.currentTarget.checked)}
                    />
                    Additional answer is optional
                  </label>
                ) : null}
                <FieldSelect
                  label="Source example"
                  value={sourceExample}
                  options={fields}
                  onInput={setSourceExample}
                  optional
                />
                <FieldSelect
                  label="Target example"
                  value={targetExample}
                  options={fields}
                  onInput={setTargetExample}
                  optional
                />
                <FieldSelect label="Optional note" value={note} options={fields} onInput={setNote} optional />
                <FieldSelect label="Audio" value={audio} options={fields} onInput={setAudio} optional />
                <TemplateSelect
                  label="Source → target card"
                  names={templateNames}
                  value={forwardOrd}
                  onInput={setForwardOrd}
                />
                <TemplateSelect
                  label="Target → source card"
                  names={templateNames}
                  value={reverseOrd}
                  onInput={setReverseOrd}
                />
              </div>
            ) : null}
            <div class="mt-8 flex flex-col-reverse justify-end gap-3 border-t border-black/8 pt-6 sm:flex-row">
              {props.onCancel ? (
                <button type="button" class="button-quiet" onClick={props.onCancel}>
                  Cancel
                </button>
              ) : null}
              <button type="submit" class="button-primary" disabled={!models.some((model) => model.enabled)}>
                <Check class="size-4" />
                Save setup
              </button>
            </div>
          </form>
        </section>
      )
    }),
)

const FieldSelect = view<{
  label: string
  value: string
  options: string[]
  onInput: (value: string) => void
  optional?: boolean
  required?: boolean
}>((props) => (
  <label class="block">
    <span class="field-label">
      {props.label}
      {props.optional ? <span class="font-medium text-[var(--muted)]">Optional</span> : null}
    </span>
    <select
      class="field-control"
      value={props.value}
      required={props.required}
      onInput={(event) => props.onInput(event.currentTarget.value)}
    >
      {props.optional ? <option value="">Not used</option> : null}
      {list(props.options, (option) => (
        <option value={option}>{option}</option>
      ))}
    </select>
  </label>
))

const TemplateSelect = view<{
  label: string
  names: string[]
  value: number
  onInput: (value: number) => void
}>((props) => (
  <label class="block">
    <span class="field-label">{props.label}</span>
    <select
      class="field-control"
      value={`${props.value}`}
      onInput={(event) => props.onInput(Number(event.currentTarget.value))}
    >
      {list(props.names, (name, index) => (
        <option value={`${index}`}>{name}</option>
      ))}
    </select>
  </label>
))

const LanguageSelect = view<{
  label: string
  value: AnswerLanguage
  onInput: (value: AnswerLanguage) => void
}>((props) => (
  <label class="block">
    <span class="field-label">{props.label}</span>
    <select
      class="field-control"
      value={props.value}
      onInput={(event) => props.onInput(event.currentTarget.value as AnswerLanguage)}
    >
      <option value="german">German</option>
      <option value="english">English</option>
      <option value="plain">Other</option>
    </select>
  </label>
))

const AnswerModeSelect = view<{
  value: AnswerMode
  onInput: (value: AnswerMode) => void
}>((props) => (
  <label class="block">
    <span class="field-label">Answer format</span>
    <select
      class="field-control"
      value={props.value}
      onInput={(event) => props.onInput(event.currentTarget.value as AnswerMode)}
    >
      <option value="parts">Separate fields</option>
      <option value="alternatives">Either field</option>
      <option value="unordered">List, any order</option>
    </select>
  </label>
))
