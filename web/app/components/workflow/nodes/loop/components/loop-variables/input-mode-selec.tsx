import { Select, SelectContent, SelectItem, SelectItemIndicator, SelectItemText, SelectTrigger } from '@langgenius/dify-ui/select'
import { useTranslation } from 'react-i18next'

type InputModeSelectProps = {
  value?: string
  onChange: (value: string) => void
}
const InputModeSelect = ({
  value,
  onChange,
}: InputModeSelectProps) => {
  const { t } = useTranslation()
  const options = [
    {
      label: 'Variable',
      value: 'variable',
    },
    {
      label: 'Constant',
      value: 'constant',
    },
  ]
  const selectedOption = options.find(option => option.value === value) ?? null

  return (
    <Select value={selectedOption?.value ?? null} onValueChange={nextValue => nextValue && onChange(nextValue)}>
      <SelectTrigger className="w-full">
        {selectedOption?.label ?? t('nodes.loop.inputMode', { ns: 'workflow' })}
      </SelectTrigger>
      <SelectContent>
        {options.map(option => (
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
