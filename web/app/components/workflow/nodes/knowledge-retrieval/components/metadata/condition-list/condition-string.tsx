import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import ConditionValueMethod from './condition-value-method'
import type { ConditionValueMethodProps } from './condition-value-method'
import ConditionVariableSelector from './condition-variable-selector'
import ConditionCommonVariableSelector from './condition-common-variable-selector.tsx'
import type {
  Node,
  NodeOutPutVar,
  ValueSelector,
} from '@/app/components/workflow/types'
import Input from '@/app/components/base/input'
import { VarType } from '@/app/components/workflow/types'

type ConditionStringProps = {
  value?: string
  onChange: (value: string) => void
  nodesOutputVars: NodeOutPutVar[]
  availableNodes: Node[]
  isCommonVariable?: boolean
  commonVariables: { name: string, type: string }[]
} & ConditionValueMethodProps
const ConditionString = ({
  value,
  onChange,
  valueMethod = 'constant',
  onValueMethodChange,
  nodesOutputVars,
  availableNodes,
  isCommonVariable,
  commonVariables,
}: ConditionStringProps) => {
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
            valueSelector={value ? value!.split('.') : []}
            onChange={handleVariableValueChange}
            nodesOutputVars={nodesOutputVars}
            availableNodes={availableNodes}
            varType={VarType.string}
          />
        )
      }
      {
        valueMethod === 'variable' && isCommonVariable && (
          <ConditionCommonVariableSelector
            variables={commonVariables}
            value={value}
            onChange={handleCommonVariableValueChange}
            varType={VarType.string}
          />
        )
      }
      {
        valueMethod === 'constant' && (
          <Input
            className='border-none bg-transparent outline-none hover:bg-transparent focus:bg-transparent focus:shadow-none'
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={t('workflow.nodes.knowledgeRetrieval.metadata.panel.placeholder')}
          />
        )
      }
    </div>
  )
}

export default ConditionString
