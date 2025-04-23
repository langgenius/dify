import { useState } from 'react'
// import { useTranslation } from 'react-i18next'
import Textarea from '@/app/components/base/textarea'
// import cn from '@/utils/classnames'

export const currentVar = {
  id: 'var-jfkldjjfkldaf-dfhekdfj',
  type: 'node',
  // type: 'conversation',
  // type: 'environment',
  name: 'out_put',
  // var_type: 'string',
  var_type: 'number',
  // var_type: 'object',
  // var_type: 'array[string]',
  // var_type: 'array[number]',
  // var_type: 'array[object]',
  // var_type: 'file',
  // var_type: 'array[file]',
  // value: 'tuituitui',
  value: 123,
  edited: true,
}

const ValueContent = () => {
  const current = currentVar
  const [value, setValue] = useState<any>(current.value ? JSON.stringify(current.value) : '')

  const handleValueChange = (value: string) => {
    if (current.var_type === 'string')
      setValue(value)

    if (current.var_type === 'number') {
      if (/^-?\d+(\.)?(\d+)?$/.test(value)) {
        console.log(value)
        setValue(value)
      }
      return
    }
    if (current.var_type === 'object') {
      // TODO update object
    }
    if (current.var_type === 'array[string]') {
      // TODO update array[string]
    }
    if (current.var_type === 'array[number]') {
      // TODO update array[number]
    }
    if (current.var_type === 'array[object]') {
      // TODO update array[object]
    }
    if (current.var_type === 'file') {
      // TODO update file
    }
    if (current.var_type === 'array[file]') {
      // TODO update array[file]
    }
  }

  return (
    <div className='flex h-full flex-col gap-3'>
      {(current.var_type === 'secret' || current.var_type === 'string' || current.var_type === 'number') && (
        <Textarea
          readOnly={current.type === 'environment'}
          disabled={current.type === 'environment'}
          className='h-full grow'
          value={value as any}
          onChange={e => handleValueChange(e.target.value)}
        />
      )}
    </div>
  )
}

export default ValueContent
