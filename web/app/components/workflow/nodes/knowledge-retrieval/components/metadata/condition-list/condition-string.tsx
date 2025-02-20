import ConditionValueMethod from './condition-value-method'
import type { ConditionValueMethodProps } from './condition-value-method'
import ConditionVariableSelector from './condition-variable-selector'

type ConditionStringProps = {} & ConditionValueMethodProps
const ConditionString = ({
  valueMethod,
  onValueMethodChange,
}: ConditionStringProps) => {
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
            onChange={() => {}}
          />
        )
      }
      {
        valueMethod === 'constant' && (
          <input />
        )
      }
    </div>
  )
}

export default ConditionString
