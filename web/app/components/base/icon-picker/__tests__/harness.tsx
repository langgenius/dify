import type { IconPickerInputValue, IconPickerValue } from '..'
import { IconPicker, IconPickerContent, IconPickerIcon, IconPickerTrigger } from '..'

type IconPickerDialogProps = {
  value?: IconPickerInputValue
  onConfirm: (value: IconPickerValue) => void
  enableImageUpload?: boolean
  'aria-label'?: string
}

/** The picker composed as one element, for specs that exercise its session rather than its anatomy. */
export function IconPickerDialog({
  value,
  onConfirm,
  enableImageUpload,
  'aria-label': label = 'app.iconPicker.title',
}: IconPickerDialogProps) {
  return (
    <IconPicker value={value} onValueChange={onConfirm}>
      <IconPickerTrigger aria-label={label}>
        <IconPickerIcon />
      </IconPickerTrigger>
      <IconPickerContent enableImageUpload={enableImageUpload} />
    </IconPicker>
  )
}
