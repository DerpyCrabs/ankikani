import { component, list, view } from 'effectweb'
import { createSelect, SelectItem, SelectPopup, SelectTrigger } from '@effectweb/base-ui/select'
import ChevronDown from '@effectweb/lucide/icons/chevron-down'

type Props = {
  label: string
  value: string
  options: { value: string; label: string; detail?: string }[]
  onOpen?: () => void
  required?: boolean
  onChoose: (value: string) => void
}

export const Choice = component({ init: (_props: Props) => ({}) }, owner => {
  let current: Props
  const select = createSelect<string>({
    onOpenChange: open => { if (open) current.onOpen?.() },
    onValueChange: value => { if (value !== null) current.onChoose(value) },
    itemToStringLabel: value => current.options.find(item => item.value === value)?.label ?? value,
  })
  owner.own(select.lifetime)
  return view(({ props }) => {
    current = props
    select.sync({ value: props.value })
    return <>
      <SelectTrigger select={select} role="combobox" aria-required={props.required} aria-label={props.label} class="choice-trigger field-control">
        <span>{select.label(props.value)}</span><ChevronDown class="size-4 shrink-0" />
      </SelectTrigger>
      <SelectPopup select={select} aria-label={props.label} class="choice-popup" alignItemWithTrigger={false} align="start" sideOffset={5}>
        {list(props.options, item => item.value, item => <SelectItem select={select} value={item.value} class="choice-option">{item.label}{item.detail ? <small class="ml-2 text-[var(--muted)]">{item.detail}</small> : null}</SelectItem>)}
      </SelectPopup>
    </>
  })
})
