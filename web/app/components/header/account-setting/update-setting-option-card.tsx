import { cn } from '@langgenius/dify-ui/cn'
import { RadioItem } from '@langgenius/dify-ui/radio'

type UpdateSettingOptionCardProps<Value extends string> = {
  value: Value
  label: string
  onBlur?: () => void
  onFocus?: () => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}

const UpdateSettingOptionCard = <Value extends string>({
  value,
  label,
  onBlur,
  onFocus,
  onMouseEnter,
  onMouseLeave,
}: UpdateSettingOptionCardProps<Value>) => {
  return (
    <RadioItem<Value>
      value={value}
      nativeButton
      render={<button type="button" />}
      onBlur={onBlur}
      onFocus={onFocus}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      title={label}
      className={cn(
        'flex min-w-0 flex-1 cursor-pointer items-center justify-center rounded-lg border border-components-option-card-option-border bg-components-option-card-option-bg p-2 px-3 text-center system-sm-regular text-text-secondary shadow-none outline-hidden transition-colors',
        'hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover',
        'focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden',
        'data-checked:border-[1.5px] data-checked:border-components-option-card-option-selected-border data-checked:bg-components-option-card-option-selected-bg data-checked:system-sm-medium data-checked:text-text-primary data-checked:shadow-xs',
      )}
    >
      <span className="max-w-full min-w-0 truncate whitespace-nowrap">{label}</span>
    </RadioItem>
  )
}

export default UpdateSettingOptionCard
