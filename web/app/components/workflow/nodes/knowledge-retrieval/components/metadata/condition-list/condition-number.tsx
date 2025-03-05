import { useCallback } from 'react'
import ConditionValueMethod from './condition-value-method'
import type { ConditionValueMethodProps } from './condition-value-method'
import ConditionVariableSelector from './condition-variable-selector'
import type {
  Node,
  NodeOutPutVar,
  ValueSelector,
} from '@/app/components/workflow/types'
import Input from '@/app/components/base/input'

type ConditionNumberProps = {
  value?: string | number
  onChange: (value: string | number) => void
  nodesOutputVars: NodeOutPutVar[]
  availableNodes: Node[]
} & ConditionValueMethodProps
const ConditionNumber = ({
  value,
  onChange,
  valueMethod,
  onValueMethodChange,
  nodesOutputVars,
  availableNodes,
}: ConditionNumberProps) => {
  const handleVariableValueChange = useCallback((v: ValueSelector) => {
    onChange(`{{#${v.join('.')}#}}`)
  }, [onChange])

  return (
    <div className='flex items-center pl-1 pr-2 h-8'>
      <ConditionValueMethod
        valueMethod={valueMethod}
        onValueMethodChange={onValueMethodChange}
      />
      <div className='ml-1 mr-1.5 w-[1px] h-4 bg-divider-regular'></div>
      {
        valueMethod === 'variable' && (
          <ConditionVariableSelector
            valueSelector={value ? (value as string).split('.') : []}
            onChange={handleVariableValueChange}
            nodesOutputVars={nodesOutputVars}
            availableNodes={availableNodes}
          />
        )
      }
      {
        valueMethod === 'constant' && (
          <Input
            className='bg-transparent hover:bg-transparent outline-none border-none focus:shadow-none focus:bg-transparent'
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder='Enter value'
            type='number'
          />
        )
      }
    </div>
  )
}

export default ConditionNumber
