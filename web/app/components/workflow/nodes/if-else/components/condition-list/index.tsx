import { RiLoopLeftLine } from '@remixicon/react'
import { LogicalOperator } from '../../types'
import type {
  CaseItem,
  HandleRemoveCondition,
  HandleUpdateCondition,
  HandleUpdateConditionLogicalOperator,
} from '../../types'
import ConditionItem from './condition-item'
import type {
  Node,
  NodeOutPutVar,
} from '@/app/components/workflow/types'

type ConditionListProps = {
  disabled?: boolean
  caseItem: CaseItem
  onUpdateCondition: HandleUpdateCondition
  onUpdateConditionLogicalOperator: HandleUpdateConditionLogicalOperator
  onRemoveCondition: HandleRemoveCondition
  nodesOutputVars: NodeOutPutVar[]
  availableNodes: Node[]
  numberVariables: NodeOutPutVar[]
}
const ConditionList = ({
  disabled,
  caseItem,
  onUpdateCondition,
  onUpdateConditionLogicalOperator,
  onRemoveCondition,
  nodesOutputVars,
  availableNodes,
  numberVariables,
}: ConditionListProps) => {
  const { conditions, logical_operator } = caseItem

  return (
    <div className='relative pl-[60px]'>
      {
        conditions.length > 1 && (
          <div className='absolute top-0 bottom-0 left-0 w-[60px]'>
            <div className='absolute top-4 bottom-4 left-[46px] w-2.5 border border-divider-deep rounded-l-[8px] border-r-0'></div>
            <div className='absolute top-1/2 -translate-y-1/2 right-0 w-4 h-[29px] bg-components-panel-bg'></div>
            <div
              className='absolute top-1/2 right-1 -translate-y-1/2 flex items-center px-1 h-[21px] rounded-md border-[0.5px] border-components-button-secondary-border shadow-xs bg-components-button-secondary-bg text-text-accent-secondary text-[10px] font-semibold cursor-pointer'
              onClick={() => {
                onUpdateConditionLogicalOperator(caseItem.case_id, caseItem.logical_operator === LogicalOperator.and ? LogicalOperator.or : LogicalOperator.and)
              }}
            >
              {logical_operator.toUpperCase()}
              <RiLoopLeftLine className='ml-0.5 w-3 h-3' />
            </div>
          </div>
        )
      }
      {
        caseItem.conditions.map(condition => (
          <ConditionItem
            key={condition.id}
            disabled={disabled}
            caseId={caseItem.case_id}
            condition={condition}
            onUpdateCondition={onUpdateCondition}
            onRemoveCondition={onRemoveCondition}
            nodesOutputVars={nodesOutputVars}
            availableNodes={availableNodes}
            numberVariables={numberVariables}
          />
        ))
      }
    </div>
  )
}

export default ConditionList
