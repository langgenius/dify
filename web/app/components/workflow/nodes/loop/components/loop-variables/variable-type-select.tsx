import {
  useState,
} from 'react'
import PureSelect from '@/app/components/base/select/pure'

const VariableTypeSelect = () => {
  const [value, setValue] = useState('')

  return (
    <PureSelect
      options={[]}
      value={value}
      onChange={setValue}
    />
  )
}

export default VariableTypeSelect
