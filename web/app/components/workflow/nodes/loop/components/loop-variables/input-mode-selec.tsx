import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { useTranslation } from 'react-i18next'
import { ValueType } from '@/app/components/workflow/types'

type InputModeSelectProps = {
  value?: ValueType
  onChange: (value: ValueType) => void
}
const InputModeSelect = ({ value, onChange }: InputModeSelectProps) => {
  const { t } = useTranslation(['workflowLogic'])
  const options = [
    {
      label: 'Variable',
      value: ValueType.variable,
    },
    {
      label: 'Constant',
      value: ValueType.constant,
    },
  ]
  const selectedOption = options.find((option) => option.value === value) ?? null

  return (
    <Select
      value={selectedOption?.value ?? null}
      onValueChange={(nextValue) => nextValue && onChange(nextValue)}
    >
      <SelectTrigger className="w-full">
        {selectedOption?.label ?? t(($) => $['nodes.loop.inputMode'], { ns: 'workflowLogic' })}
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            <SelectItemText>{option.label}</SelectItemText>
            <SelectItemIndicator />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export default InputModeSelect
