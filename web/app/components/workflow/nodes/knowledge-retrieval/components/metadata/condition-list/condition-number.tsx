import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import ConditionValueMethod from './condition-value-method'
import type { ConditionValueMethodProps } from './condition-value-method'
import ConditionVariableSelector from './condition-variable-selector'
import ConditionCommonVariableSelector from './condition-common-variable-selector'
import type {
  Node,
  NodeOutPutVar,
  ValueSelector,
} from '@/app/components/workflow/types'
import { VarType } from '@/app/components/workflow/types'
import Input from '@/app/components/base/input'

type ConditionNumberProps = {
  value?: string | number
  onChange: (value?: string | number) => void
  nodesOutputVars: NodeOutPutVar[]
  availableNodes: Node[]
  isCommonVariable?: boolean
  commonVariables: { name: string; type: string; value: string }[]
} & ConditionValueMethodProps
const ConditionNumber = ({
  value,
  onChange,
  valueMethod,
  onValueMethodChange,
  nodesOutputVars,
  availableNodes,
  isCommonVariable,
  commonVariables,
}: ConditionNumberProps) => {
  const { t } = useTranslation()
  const handleVariableValueChange = useCallback((v: ValueSelector) => {
    onChange(`{{#${v.join('.')}#}}`)
  }, [onChange])

  const handleCommonVariableValueChange = useCallback((v: string) => {
    onChange(`{{${v}}}`)
  }, [onChange])

  return (
    <div className='flex h-8 items-center pl-1 pr-2'>
      <ConditionValueMethod
        valueMethod={valueMethod}
        onValueMethodChange={onValueMethodChange}
      />
      <div className='ml-1 mr-1.5 h-4 w-[1px] bg-divider-regular'></div>
      {
        valueMethod === 'variable' && !isCommonVariable && (
          <ConditionVariableSelector
            valueSelector={value ? (value as string).split('.') : []}
            onChange={handleVariableValueChange}
            nodesOutputVars={nodesOutputVars}
            availableNodes={availableNodes}
            varType={VarType.number}
          />
        )
      }
      {
        valueMethod === 'variable' && isCommonVariable && (
          <ConditionCommonVariableSelector
            variables={commonVariables}
            value={value}
            onChange={handleCommonVariableValueChange}
            varType={VarType.number}
          />
        )
      }
      {
        valueMethod === 'constant' && (
          <Input
            className='border-none bg-transparent outline-none hover:bg-transparent focus:bg-transparent focus:shadow-none'
            value={value}
            onChange={(e) => {
              const v = e.target.value
              onChange(v ? Number(e.target.value) : undefined)
            }}
            placeholder={t('workflow.nodes.knowledgeRetrieval.metadata.panel.placeholder')}
            type='number'
          />
        )
      }
    </div>
  )
}

export default ConditionNumber
