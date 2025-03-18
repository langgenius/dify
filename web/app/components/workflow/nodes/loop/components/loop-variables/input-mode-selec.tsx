import {
  useState,
} from 'react'
import PureSelect from '@/app/components/base/select/pure'

const InputModeSelect = () => {
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
  const [value, setValue] = useState('variable')

  return (
    <PureSelect
      options={options}
      value={value}
      onChange={setValue}
      popupProps={{
        title: 'Input Mode',
      }}
    />
  )
}

export default InputModeSelect
