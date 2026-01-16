import { useTranslation } from 'react-i18next'
import PureSelect from '@/app/components/base/select/pure'

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

  return (
    <PureSelect
      options={options}
      value={value}
      onChange={onChange}
      popupProps={{
        title: t('nodes.loop.inputMode', { ns: 'workflow' }),
        className: 'w-[132px]',
      }}
    />
  )
}

export default InputModeSelect
