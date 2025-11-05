import { RiLoopLeftLine } from '@remixicon/react'
import { useMemo } from 'react'
import ConditionItem from './condition-item'
import type {
  AgentToolCondition,
  AgentToolConditionLogicalOperator,
} from '../../types'
import type {
  Node,
  NodeOutPutVar,
} from '@/app/components/workflow/types'
import cn from '@/utils/classnames'

type Props = {
  conditions: AgentToolCondition[]
  logicalOperator: AgentToolConditionLogicalOperator
  availableVars: NodeOutPutVar[]
  availableNodes: Node[]
  disabled?: boolean
  onChange: (condition: AgentToolCondition) => void
  onRemove: (conditionId: string) => void
  onToggleLogicalOperator: () => void
}

const ConditionList = ({
  conditions,
  logicalOperator,
  availableVars,
  availableNodes,
  disabled,
  onChange,
  onRemove,
  onToggleLogicalOperator,
}: Props) => {
  const hasMultiple = conditions.length > 1

  const containerClassName = useMemo(() => cn('relative', hasMultiple && 'pl-[60px]'), [hasMultiple])

  return (
    <div className={containerClassName}>
      {hasMultiple && (
        <div className='absolute bottom-0 left-0 top-0 w-[60px]'>
          <div className='absolute bottom-4 left-[46px] top-4 w-2.5 rounded-l-[8px] border border-r-0 border-divider-deep'></div>
          <div className='absolute right-0 top-1/2 h-[29px] w-4 -translate-y-1/2 bg-components-panel-bg'></div>
          <button
            type='button'
            className='absolute right-1 top-1/2 flex h-5 -translate-y-1/2 items-center gap-1 rounded-md border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-1.5 text-[10px] font-semibold uppercase text-text-accent-secondary shadow-xs disabled:cursor-not-allowed disabled:opacity-60'
            onClick={onToggleLogicalOperator}
            disabled={disabled}
          >
            {logicalOperator.toUpperCase()}
            <RiLoopLeftLine className='h-3 w-3' />
          </button>
        </div>
      )}
      {conditions.map(condition => (
        <ConditionItem
          key={condition.id}
          className=''
          condition={condition}
          availableVars={availableVars}
          availableNodes={availableNodes}
          disabled={disabled}
          onChange={onChange}
          onRemove={() => onRemove(condition.id)}
        />
      ))}
    </div>
  )
}

export default ConditionList
