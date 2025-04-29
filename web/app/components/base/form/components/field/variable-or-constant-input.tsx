import { useState } from 'react'
import { RiEditLine } from '@remixicon/react'
import cn from '@/utils/classnames'
import SegmentedControl from '@/app/components/base/segmented-control'
import { VariableX } from '@/app/components/base/icons/src/vender/workflow'
import type { LabelProps } from '../label'
import Label from '../label'

type VariableOrConstantInputFieldProps = {
  label: string
  labelOptions?: Omit<LabelProps, 'htmlFor' | 'label'>
  className?: string
}

const VariableOrConstantInputField = ({
  className,
  label,
  labelOptions,
}: VariableOrConstantInputFieldProps) => {
  const [variableType, setVariableType] = useState('variable')

  const options = [
    {
      Icon: VariableX,
      text: '',
      value: 'variable',
    },
    {
      Icon: RiEditLine,
      text: '',
      value: 'constant',
    },
  ]

  const handleVariableOrConstantChange = (value: string) => {
    setVariableType(value)
  }

  return (
    <div className={cn('flex flex-col gap-y-0.5', className)}>
      <Label
        htmlFor={'variable-or-constant'}
        label={label}
        {...(labelOptions ?? {})}
      />
      <div className='flex items-center'>
        <SegmentedControl
          className='mr-1 shrink-0'
          value={variableType}
          onChange={handleVariableOrConstantChange as any}
          options={options as any}
        />
      </div>
    </div>
  )
}

export default VariableOrConstantInputField
