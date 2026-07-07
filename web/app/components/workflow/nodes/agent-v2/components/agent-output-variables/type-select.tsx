import type { OutputTypeOptionValue } from './utils'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectLabel,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { useTranslation } from 'react-i18next'
import { getOutputTypeOption, OUTPUT_TYPE_OPTIONS } from './utils'

export function OutputTypeSelect({
  value,
  onChange,
}: {
  value: OutputTypeOptionValue
  onChange: (value: OutputTypeOptionValue) => void
}) {
  const { t } = useTranslation()
  const selected = getOutputTypeOption(value)

  return (
    <Select<OutputTypeOptionValue>
      value={value}
      onValueChange={(nextValue) => {
        if (nextValue)
          onChange(nextValue)
      }}
    >
      <SelectLabel className="sr-only">
        {t('nodes.agent.outputVars.typeLabel', { ns: 'workflow' })}
      </SelectLabel>
      <SelectTrigger
        aria-label={t('nodes.agent.outputVars.typeLabel', { ns: 'workflow' })}
        className="h-6 w-auto rounded-md bg-transparent px-1 py-0 system-xs-medium text-text-tertiary hover:bg-state-base-hover"
      >
        {selected.label}
      </SelectTrigger>
      <SelectContent popupClassName="w-40">
        {OUTPUT_TYPE_OPTIONS.map(option => (
          <SelectItem key={option.value} value={option.value}>
            <SelectItemText>{option.label}</SelectItemText>
            <SelectItemIndicator />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
