import type { ChangeEvent } from 'react'
import { useState } from 'react'
import { RiEditLine } from '@remixicon/react'
import cn from '@/utils/classnames'
import SegmentedControl from '@/app/components/base/segmented-control'
import { VariableX } from '@/app/components/base/icons/src/vender/workflow'
import Input from '@/app/components/base/input'
import VarReferencePicker from '@/app/components/workflow/nodes/_base/components/variable/var-reference-picker'
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
      value: 'variable',
    },
    {
      Icon: RiEditLine,
      value: 'constant',
    },
  ]

  const handleVariableOrConstantChange = (value: string) => {
    setVariableType(value)
  }

  const handleVariableValueChange = () => {
    console.log('Variable value changed')
  }

  const handleConstantValueChange = (e: ChangeEvent<HTMLInputElement>) => {
    console.log('Constant value changed:', e.target.value)
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
        {
          variableType === 'variable' && (
            <VarReferencePicker
              className='grow'
              nodeId=''
              readonly={false}
              value={[]}
              onChange={handleVariableValueChange}
            />
          )
        }
        {
          variableType === 'constant' && (
            <Input
              className='ml-1'
              onChange={handleConstantValueChange}
            />
          )
        }
      </div>
    </div>
  )
}

export default VariableOrConstantInputField
