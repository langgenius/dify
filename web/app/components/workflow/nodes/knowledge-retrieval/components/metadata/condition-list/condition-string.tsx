import { useCallback } from 'react'
import ConditionValueMethod from './condition-value-method'
import type { ConditionValueMethodProps } from './condition-value-method'
import ConditionVariableSelector from './condition-variable-selector'
import type {
  Node,
  NodeOutPutVar,
  ValueSelector,
} from '@/app/components/workflow/types'

type ConditionStringProps = {
  value?: string
  onChange: (value: string) => void
  nodesOutputVars: NodeOutPutVar[]
  availableNodes: Node[]
} & ConditionValueMethodProps
const ConditionString = ({
  value,
  onChange,
  valueMethod,
  onValueMethodChange,
  nodesOutputVars,
  availableNodes,
}: ConditionStringProps) => {
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
            valueSelector={value!.split('.')}
            onChange={handleVariableValueChange}
            nodesOutputVars={nodesOutputVars}
            availableNodes={availableNodes}
          />
        )
      }
      {
        valueMethod === 'constant' && (
          <input
            value={value}
            onChange={e => onChange(e.target.value)}
          />
        )
      }
    </div>
  )
}

export default ConditionString
