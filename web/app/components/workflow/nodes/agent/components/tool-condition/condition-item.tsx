import {
  useCallback,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { RiDeleteBinLine } from '@remixicon/react'
import { produce } from 'immer'
import ConditionVarSelector from './condition-var-selector'
import ConditionOperator from './condition-operator'
import {
  getConditionOperators,
  getDefaultValueByType,
  operatorNeedsValue,
} from '../../utils'
import type {
  AgentToolCondition,
} from '../../types'
import type {
  Node,
  NodeOutPutVar,
  ValueSelector,
  Var,
} from '@/app/components/workflow/types'
import { VarType } from '@/app/components/workflow/types'
import Input from '@/app/components/base/input'
import { SimpleSelect as Select } from '@/app/components/base/select'
import ConditionInput from './condition-input'
import cn from '@/utils/classnames'

type Props = {
  className?: string
  condition: AgentToolCondition
  availableVars: NodeOutPutVar[]
  availableNodes: Node[]
  disabled?: boolean
  onChange: (condition: AgentToolCondition) => void
  onRemove: () => void
}

const ConditionItem = ({
  className,
  condition,
  availableVars,
  availableNodes,
  disabled,
  onChange,
  onRemove,
}: Props) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const needsValue = operatorNeedsValue(condition.comparison_operator)
  const booleanOptions = useMemo(() => ([
    { name: t('common.operation.yes'), value: 'true' },
    { name: t('common.operation.no'), value: 'false' },
  ]), [t])

  const handleSelectVar = useCallback((valueSelector: ValueSelector, varItem: Var) => {
    const operators = getConditionOperators(varItem.type)
    const defaultOperator = operators[0]
    const nextCondition = produce(condition, (draft) => {
      draft.variable_selector = valueSelector
      draft.varType = varItem.type
      draft.comparison_operator = defaultOperator
      draft.value = operatorNeedsValue(defaultOperator) ? getDefaultValueByType(varItem.type) : undefined
    })
    onChange(nextCondition)
  }, [condition, onChange])

  const handleOperatorChange = useCallback((operator: string) => {
    const nextCondition = produce(condition, (draft) => {
      draft.comparison_operator = operator
      if (operatorNeedsValue(operator))
        draft.value = draft.varType ? getDefaultValueByType(draft.varType) : ''
      else
        draft.value = undefined
    })
    onChange(nextCondition)
  }, [condition, onChange])

  const handleValueChange = useCallback((value: string | boolean) => {
    const nextCondition = produce(condition, (draft) => {
      draft.value = value
    })
    onChange(nextCondition)
  }, [condition, onChange])

  const handleTextValueChange = useCallback((value: string) => {
    handleValueChange(value)
  }, [handleValueChange])

  const handleBooleanValueChange = useCallback((value: boolean) => {
    handleValueChange(value)
  }, [handleValueChange])

  const renderValueInput = () => {
    if (!needsValue)
      return <div className='system-xs-regular text-text-tertiary'>{t('workflow.nodes.agent.toolCondition.noValueNeeded')}</div>

    if (condition.varType === VarType.boolean) {
      const currentBooleanValue = typeof condition.value === 'boolean'
        ? String(condition.value)
        : undefined

      return (
        <Select
          className='h-8'
          optionWrapClassName='w-32'
          defaultValue={currentBooleanValue}
          items={booleanOptions}
          onSelect={item => handleBooleanValueChange(item.value === 'true')}
          disabled={disabled}
          hideChecked
          notClearable
        />
      )
    }

    const normalizedValue = typeof condition.value === 'string' || typeof condition.value === 'number'
      ? String(condition.value)
      : ''

    if (condition.varType === VarType.number) {
      return (
        <Input
          value={normalizedValue}
          onChange={event => handleTextValueChange(event.target.value)}
          disabled={disabled}
        />
      )
    }

    const textValue = typeof condition.value === 'string' ? condition.value : ''

    return (
      <ConditionInput
        value={textValue}
        onChange={handleTextValueChange}
        disabled={disabled}
        availableNodes={availableNodes}
      />
    )
  }

  return (
    <div className={cn('mb-1 flex w-full last-of-type:mb-0', className)}>
      <div className='flex-1 rounded-lg bg-components-input-bg-normal'>
        <div className='flex items-center p-1'>
          <div className='w-0 grow'>
            <ConditionVarSelector
              open={open}
              onOpenChange={setOpen}
              valueSelector={condition.variable_selector}
              varType={condition.varType}
              availableVars={availableVars}
              availableNodes={availableNodes}
              onSelect={handleSelectVar}
              disabled={disabled}
            />
          </div>
          <div className='mx-1 h-3 w-[1px] bg-divider-regular' />
          <ConditionOperator
            varType={condition.varType}
            value={condition.comparison_operator}
            onSelect={handleOperatorChange}
            disabled={disabled || !condition.variable_selector}
          />
        </div>
        <div className='border-t border-divider-subtle px-3 py-2'>
          {renderValueInput()}
        </div>
      </div>
      <button
        type='button'
        className='ml-1 mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-state-destructive-hover hover:text-text-destructive'
        onClick={onRemove}
        disabled={disabled}
      >
        <RiDeleteBinLine className='h-4 w-4' />
      </button>
    </div>
  )
}

export default ConditionItem
