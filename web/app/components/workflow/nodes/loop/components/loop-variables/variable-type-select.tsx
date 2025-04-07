import PureSelect from '@/app/components/base/select/pure'
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
  ]

  return (
    <PureSelect
      options={options}
      value={value}
      onChange={onChange}
      popupProps={{
        className: 'w-[132px]',
      }}
    />
  )
}

export default VariableTypeSelect
