import type { ComponentProps, ReactNode } from 'react'
import type { IconPickerInputValue, IconPickerValue } from '@/app/components/base/icon-picker'
import { createContext, use, useState } from 'react'

type PickerContextValue = {
  value?: IconPickerInputValue
  onValueChange: (value: IconPickerValue) => void
  open: boolean
  setOpen: (open: boolean) => void
}

const PickerContext = createContext<PickerContextValue | null>(null)

const usePicker = () => use(PickerContext)!

/**
 * Stand-in for the icon picker parts in specs that own a form around it:
 * `vi.mock('@/app/components/base/icon-picker', () => import('@/test/icon-picker-mock'))`.
 * The trigger shows the committed icon as text, and the content confirms a fixed emoji.
 */
export function IconPicker({
  value,
  onValueChange,
  children,
}: Pick<PickerContextValue, 'value' | 'onValueChange'> & { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return <PickerContext value={{ value, onValueChange, open, setOpen }}>{children}</PickerContext>
}

export function IconPickerTrigger(props: ComponentProps<'button'>) {
  const { setOpen } = usePicker()
  return <button type="button" {...props} onClick={() => setOpen(true)} />
}

export function IconPickerIcon() {
  const { value } = usePicker()
  return value?.type === 'emoji' ? `${value.icon}:${value.background}` : value?.type
}

export function IconPickerContent() {
  const { open, setOpen, onValueChange } = usePicker()
  if (!open) return null
  return (
    <button
      type="button"
      onClick={() => {
        onValueChange({ type: 'emoji', icon: '🧠', background: '#E0F2FE' })
        setOpen(false)
      }}
    >
      Select brain icon
    </button>
  )
}
