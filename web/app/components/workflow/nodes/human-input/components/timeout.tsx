import type { FC } from 'react'
import { NumberField, NumberFieldGroup, NumberFieldInput } from '@langgenius/dify-ui/number-field'
import { SegmentedControl, SegmentedControlItem } from '@langgenius/dify-ui/segmented-control'
import { useTranslation } from 'react-i18next'

const i18nPrefix = 'nodes.humanInput'

type Props = Readonly<{
  timeout: number
  unit: 'day' | 'hour'
  onChange: (state: { timeout: number; unit: 'day' | 'hour' }) => void
  readonly?: boolean
}>

const unitOptionClassName =
  'cursor-pointer border-0 text-text-tertiary transition-none data-checked:border-0 data-checked:shadow-sm data-checked:shadow-black/10 data-checked:hover:bg-components-segmented-control-item-active-bg data-checked:hover:text-text-accent-light-mode-only data-disabled:cursor-default data-disabled:text-text-tertiary data-disabled:data-checked:bg-components-segmented-control-item-active-bg data-disabled:data-checked:text-text-accent-light-mode-only data-disabled:data-checked:shadow-sm data-disabled:data-checked:shadow-black/10'

const TimeoutInput: FC<Props> = ({ timeout, unit, onChange, readonly }) => {
  const { t } = useTranslation()
  const timeoutLabel = t(($) => $[`${i18nPrefix}.timeout.title`], { ns: 'workflow' })
  const daysLabel = t(($) => $[`${i18nPrefix}.timeout.days`], { ns: 'workflow' })
  const hoursLabel = t(($) => $[`${i18nPrefix}.timeout.hours`], { ns: 'workflow' })

  return (
    <div className="flex items-center gap-1">
      <NumberField
        value={timeout}
        min={1}
        onValueChange={(value) => onChange({ timeout: value ?? 1, unit })}
        disabled={readonly}
      >
        <NumberFieldGroup className="w-16">
          <NumberFieldInput aria-label={timeoutLabel} />
        </NumberFieldGroup>
      </NumberField>
      <SegmentedControl<'day' | 'hour'>
        value={unit}
        onValueChange={(unit) => onChange({ timeout, unit })}
        disabled={readonly}
        aria-label={timeoutLabel}
        className="gap-0.5"
      >
        <SegmentedControlItem value="day" className={unitOptionClassName}>
          <div className="p-0.5 system-sm-medium">{daysLabel}</div>
        </SegmentedControlItem>
        <SegmentedControlItem value="hour" className={unitOptionClassName}>
          <div className="p-0.5 system-sm-medium">{hoursLabel}</div>
        </SegmentedControlItem>
      </SegmentedControl>
    </div>
  )
}

export default TimeoutInput
