import { useCallback, useEffect } from 'react'
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

type ConditionArrayProps = {
  value?: string | string[] | (string | number)[]
  onChange: (value?: string | string[] | (string | number)[]) => void
  nodesOutputVars: NodeOutPutVar[]
  availableNodes: Node[]
  isCommonVariable?: boolean
  commonVariables: { name: string, type: string }[]
} & ConditionValueMethodProps

const ConditionArray = ({
  value,
  onChange,
  valueMethod = 'constant',
  onValueMethodChange,
  nodesOutputVars,
  availableNodes,
  isCommonVariable,
  commonVariables,
}: ConditionArrayProps) => {
  const { t } = useTranslation()

  const parseValueSelector = useCallback((value?: string | string[] | (string | number)[]): string[] => {
    if (typeof value !== 'string')
      return []

    // 支持多种格式：
    // 1. {{#nodeId.variable#}} 格式
    if (value.includes('#')) {
      const match = value.match(/\{\{#([^#]+)#\}\}/)
      if (match && match[1])
        return match[1].split('.')
    }

    // 2. nodeId.variable 格式（直接格式）
    if (value.includes('.'))
      return value.split('.')

    return []
  }, [])

  const currentValueSelector = parseValueSelector(value)

  useEffect(() => {
    console.log('🔍 ConditionArray Debug:')
    console.log('  - valueMethod:', valueMethod)
    console.log('  - isCommonVariable:', isCommonVariable)
    console.log('  - value:', value)
    console.log('  - currentValueSelector:', currentValueSelector)
    console.log('  - nodesOutputVars (数组变量):', nodesOutputVars)
    console.log('  - availableNodes:', availableNodes)
    console.log('  - commonVariables (通用数组变量):', commonVariables)
  }, [valueMethod, isCommonVariable, value, currentValueSelector, nodesOutputVars, availableNodes, commonVariables])

  const handleVariableValueChange = useCallback((v: ValueSelector) => {
    console.log('🔧 数组变量被选择:', v)
    onChange(`{{#${v.join('.')}#}}`)
  }, [onChange])

  const handleCommonVariableValueChange = useCallback((v: string) => {
    console.log('🔧 通用数组变量被选择:', v)
    onChange(`{{${v}}}`)
  }, [onChange])

  const handleConstantValueChange = useCallback((inputValue: string) => {
    // Parse comma-separated values into array
    if (inputValue.trim() === '') {
      onChange([])
      return
    }

    // Split by comma and trim whitespace
    const arrayValues = inputValue.split(',').map((item) => {
      const trimmed = item.trim()
      if (trimmed === '') return null

      // Try to convert to number if it's a valid number (only if it looks like a pure numeric value)
      if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
        const numericValue = Number(trimmed)
        if (!isNaN(numericValue) && isFinite(numericValue))
          return numericValue
      }

      // Otherwise keep as string (remove quotes if present)
      return trimmed.replace(/^["']|["']$/g, '')
    }).filter(item => item !== null)

    console.log('🔧 常量数组值被设置:', arrayValues)
    console.log('🔧 数组类型检测:', arrayValues.map(v => typeof v))
    onChange(arrayValues)
  }, [onChange])

  const displayValue = Array.isArray(value) ? value.map(v => String(v)).join(', ') : (value || '')

  // Filter available variables to show only array types
  const filteredNodesOutputVars = nodesOutputVars.filter(nodeVar =>
    nodeVar.vars.some(v =>
      v.type === VarType.arrayString
      || v.type === VarType.arrayNumber
      || v.type === VarType.arrayObject
      || v.type === VarType.arrayFile
      || v.type === VarType.array
      || v.type.toString().startsWith('array'),
    ),
  )

  const filteredCommonVariables = commonVariables.filter(v =>
    v.type === 'array'
    || v.type.startsWith('array'),
  )

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
            valueSelector={currentValueSelector}
            onChange={handleVariableValueChange}
            nodesOutputVars={filteredNodesOutputVars}
            availableNodes={availableNodes}
            varType='array'
          />
        )
      }
      {
        valueMethod === 'variable' && isCommonVariable && (
          <ConditionCommonVariableSelector
            variables={filteredCommonVariables}
            value={typeof value === 'string' ? value : ''}
            onChange={handleCommonVariableValueChange}
            varType={VarType.array}
          />
        )
      }
      {
        valueMethod === 'constant' && (
          <Input
            className='border-none bg-transparent outline-none hover:bg-transparent focus:bg-transparent focus:shadow-none'
            value={displayValue}
            onChange={e => handleConstantValueChange(e.target.value)}
            placeholder={t('workflow.nodes.knowledgeRetrieval.metadata.panel.arrayPlaceholder') || 'Enter comma-separated values'}
          />
        )
      }
    </div>
  )
}

export default ConditionArray
