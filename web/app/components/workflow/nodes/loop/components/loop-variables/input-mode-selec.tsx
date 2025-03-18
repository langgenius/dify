import PureSelect from '@/app/components/base/select/pure'

type InputModeSelectProps = {
  value?: string
  onChange: (value: string) => void
}
const InputModeSelect = ({
  value,
  onChange,
}: InputModeSelectProps) => {
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

  return (
    <PureSelect
      options={options}
      value={value}
      onChange={onChange}
      popupProps={{
        title: 'Input Mode',
        className: 'w-[132px]',
      }}
    />
  )
}

export default InputModeSelect
