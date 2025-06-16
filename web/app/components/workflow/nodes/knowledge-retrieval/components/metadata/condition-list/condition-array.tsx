import { useCallback, useMemo } from 'react'
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
import type { MetadataFilteringVariableType } from '@/app/components/workflow/nodes/knowledge-retrieval/types'

type ConditionArrayProps = {
  value?: string | string[] | (string | number)[] | number
  onChange: (value?: string | string[] | (string | number)[]) => void
  nodesOutputVars: NodeOutPutVar[]
  availableNodes: Node[]
  isCommonVariable?: boolean
  commonVariables: { name: string, type: string }[]
  fieldType?: MetadataFilteringVariableType
  strictTypeChecking?: boolean
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
  fieldType,
  strictTypeChecking = false,
}: ConditionArrayProps) => {
  const { t } = useTranslation()

  const parseValueSelector = useCallback((value?: string | string[] | (string | number)[] | number): string[] => {
    if (typeof value !== 'string')
      return []

    // Support multiple formats:
    // 1. {{#nodeId.variable#}} format
    if (value.includes('#')) {
      const match = value.match(/\{\{#([^#]+)#\}\}/)
      if (match && match[1])
        return match[1].split('.')
    }

    // 2. nodeId.variable format (direct format)
    if (value.includes('.'))
      return value.split('.')

    return []
  }, [])

  const currentValueSelector = parseValueSelector(value)

  const handleVariableValueChange = useCallback((v: ValueSelector) => {
    onChange(`{{#${v.join('.')}#}}`)
  }, [onChange])

  const handleCommonVariableValueChange = useCallback((v: string) => {
    onChange(`{{${v}}}`)
  }, [onChange])

  // Type compatibility check
  const checkTypeCompatibility = useCallback((selectedVariable: any) => {
    if (!fieldType || !selectedVariable) return null

    // Get variable type
    const variableType = selectedVariable.type || selectedVariable.value_type

    // Define compatibility rules
    const compatibilityRules: Record<string, string[]> = {
      string: ['array[string]', 'array', 'string'],
      number: ['array[number]', 'array', 'number'],
      select: ['array[string]', 'array', 'string'],
      array: ['array[string]', 'array[number]', 'array[object]', 'array'],
      time: ['array[string]', 'array', 'string'], // Time field compatibility
    }

    const compatibleTypes = compatibilityRules[fieldType as string] || []

    if (!compatibleTypes.includes(variableType)) {
      return {
        warning: true,
        message: `⚠️ Type mismatch: ${fieldType} field is not recommended to use ${variableType} type variables`,
      }
    }

    return null
  }, [fieldType])

  // Check if currently selected variable is compatible
  const typeCompatibilityCheck = useMemo(() => {
    if (valueMethod === 'variable' && currentValueSelector.length > 0) {
      // Find currently selected variable information
      const selectedVar = nodesOutputVars.find(nodeVar =>
        nodeVar.nodeId === currentValueSelector[0],
      )?.vars.find(v => v.variable === currentValueSelector[1])

      return checkTypeCompatibility(selectedVar)
    }
    return null
  }, [valueMethod, currentValueSelector, nodesOutputVars, checkTypeCompatibility])

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

      // Keep natural type detection: pure numbers auto-convert to numbers, otherwise keep as strings
      if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
        const numericValue = Number(trimmed)
        if (!isNaN(numericValue) && isFinite(numericValue))
          return numericValue
      }

      // Remove quotes (if any) and keep as string
      return trimmed.replace(/^["']|["']$/g, '')
    }).filter(item => item !== null)

    onChange(arrayValues)
  }, [onChange])

  const displayValue = Array.isArray(value) ? value.map(v => String(v)).join(', ') : (value || '')

  // Filter variables based on strict mode
  const filteredNodesOutputVars = useMemo(() => {
    const basicFilter = nodesOutputVars.filter(nodeVar =>
      nodeVar.vars.some(v =>
        v.type === VarType.arrayString
        || v.type === VarType.arrayNumber
        || v.type === VarType.arrayObject
        || v.type === VarType.arrayFile
        || v.type === VarType.array
        || v.type.toString().startsWith('array'),
      ),
    )

    if (!strictTypeChecking || !fieldType)
      return basicFilter

    // Strict mode: only show type-compatible variables
    return basicFilter.map(nodeVar => ({
      ...nodeVar,
      vars: nodeVar.vars.filter((v) => {
        const typeCheck = checkTypeCompatibility(v)
        return !typeCheck?.warning
      }),
    })).filter(nodeVar => nodeVar.vars.length > 0)
  }, [nodesOutputVars, strictTypeChecking, fieldType, checkTypeCompatibility])

  const filteredCommonVariables = useMemo(() => {
    const basicFilter = commonVariables.filter(v =>
      v.type === 'array'
      || v.type.startsWith('array'),
    )

    if (!strictTypeChecking || !fieldType)
      return basicFilter

    // Strict mode: only show type-compatible variables
    return basicFilter.filter((v) => {
      const typeCheck = checkTypeCompatibility(v)
      return !typeCheck?.warning
    })
  }, [commonVariables, strictTypeChecking, fieldType, checkTypeCompatibility])

  return (
    <div className='flex h-8 items-center pl-1 pr-2'>
      <ConditionValueMethod
        valueMethod={valueMethod}
        onValueMethodChange={onValueMethodChange}
      />
      <div className='ml-1 mr-1.5 h-4 w-[1px] bg-divider-regular'></div>
      {
        valueMethod === 'variable' && !isCommonVariable && (
          <div className='flex-1'>
            <ConditionVariableSelector
              valueSelector={currentValueSelector}
              onChange={handleVariableValueChange}
              nodesOutputVars={filteredNodesOutputVars}
              availableNodes={availableNodes}
              varType='array'
            />
            {typeCompatibilityCheck?.warning && (
              <div className='mt-1 text-xs text-text-warning'>
                {typeCompatibilityCheck.message}
              </div>
            )}
          </div>
        )
      }
      {
        valueMethod === 'variable' && isCommonVariable && (
          <div className='flex-1'>
            <ConditionCommonVariableSelector
              variables={filteredCommonVariables}
              value={typeof value === 'string' ? value : ''}
              onChange={handleCommonVariableValueChange}
              varType={VarType.array}
            />
            {typeCompatibilityCheck?.warning && (
              <div className='mt-1 text-xs text-text-warning'>
                {typeCompatibilityCheck.message}
              </div>
            )}
          </div>
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
