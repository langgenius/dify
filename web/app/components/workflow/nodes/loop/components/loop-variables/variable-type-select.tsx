import { Select, SelectContent, SelectItem, SelectItemIndicator, SelectItemText, SelectTrigger } from '@langgenius/dify-ui/select'
import { VarType } from '@/app/components/workflow/types'

type VariableTypeSelectProps = {
  value?: string
  onChange: (value: string) => void
}
const VariableTypeSelect = ({
  value,
  onChange,
}: VariableTypeSelectProps) => {
  const options = [
    {
      label: 'String',
      value: VarType.string,
    },
    {
      label: 'Number',
      value: VarType.number,
    },
    {
      label: 'Object',
      value: VarType.object,
    },
    {
      label: 'Boolean',
      value: VarType.boolean,
    },
    {
      label: 'Array[string]',
      value: VarType.arrayString,
    },
    {
      label: 'Array[number]',
      value: VarType.arrayNumber,
    },
    {
      label: 'Array[object]',
      value: VarType.arrayObject,
    },
    {
      label: 'Array[boolean]',
      value: VarType.arrayBoolean,
    },
  ]
  const selectedOption = options.find(option => option.value === value) ?? null

  return (
    <Select value={selectedOption?.value ?? null} onValueChange={nextValue => nextValue && onChange(nextValue)}>
      <SelectTrigger className="w-full">
        {selectedOption?.label}
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

export default VariableTypeSelect
