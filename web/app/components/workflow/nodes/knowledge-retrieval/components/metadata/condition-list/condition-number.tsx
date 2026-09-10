import type { ConditionValueMethodProps } from './condition-value-method'
import type { Node, NodeOutPutVar, ValueSelector } from '@/app/components/workflow/types'
import { NumberField, NumberFieldGroup, NumberFieldInput } from '@langgenius/dify-ui/number-field'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { VarType } from '@/app/components/workflow/types'
import ConditionCommonVariableSelector from './condition-common-variable-selector'
import ConditionValueMethod from './condition-value-method'
import ConditionVariableSelector from './condition-variable-selector'

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
  const handleVariableValueChange = useCallback(
    (v: ValueSelector) => {
      onChange(`{{#${v.join('.')}#}}`)
    },
    [onChange],
  )

  const handleCommonVariableValueChange = useCallback(
    (v: string) => {
      onChange(`{{${v}}}`)
    },
    [onChange],
  )

  return (
    <div className="flex h-8 items-center pr-2 pl-1">
      <ConditionValueMethod valueMethod={valueMethod} onValueMethodChange={onValueMethodChange} />
      <div className="mr-1.5 ml-1 h-4 w-px bg-divider-regular"></div>
      {valueMethod === 'variable' && !isCommonVariable && (
        <ConditionVariableSelector
          valueSelector={value ? (value as string).split('.') : []}
          onChange={handleVariableValueChange}
          nodesOutputVars={nodesOutputVars}
          availableNodes={availableNodes}
          varType={VarType.number}
        />
      )}
      {valueMethod === 'variable' && isCommonVariable && (
        <ConditionCommonVariableSelector
          variables={commonVariables}
          value={value}
          onChange={handleCommonVariableValueChange}
          varType={VarType.number}
        />
      )}
      {valueMethod === 'constant' && (
        <NumberField
          className="min-w-0 flex-1"
          value={typeof value === 'number' ? value : null}
          format={{ maximumSignificantDigits: 21, useGrouping: false }}
          onValueChange={(value) => onChange(value ?? undefined)}
        >
          <NumberFieldGroup className="border-0 bg-transparent hover:bg-transparent">
            <NumberFieldInput
              className="rounded-lg focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:ring-inset"
              inputMode="decimal"
              aria-label={t(($) => $['nodes.knowledgeRetrieval.metadata.panel.placeholder'], {
                ns: 'workflow',
              })}
              placeholder={t(($) => $['nodes.knowledgeRetrieval.metadata.panel.placeholder'], {
                ns: 'workflow',
              })}
            />
          </NumberFieldGroup>
        </NumberField>
      )}
    </div>
  )
}

export default ConditionNumber
