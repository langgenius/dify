import type { FC } from 'react'
import {
  memo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { ReactSortable } from 'react-sortablejs'
import {
  RiAddLine,
  RiDeleteBinLine,
  RiDraggable,
} from '@remixicon/react'
import useConfig from './use-config'
import ConditionAdd from './components/condition-add'
import ConditionList from './components/condition-list'
import type { IfElseNodeType } from './types'
import Button from '@/app/components/base/button'
import type { NodePanelProps } from '@/app/components/workflow/types'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import { useGetAvailableVars } from '@/app/components/workflow/nodes/variable-assigner/hooks'
import cn from '@/utils/classnames'
const i18nPrefix = 'workflow.nodes.ifElse'

const Panel: FC<NodePanelProps<IfElseNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()
  const getAvailableVars = useGetAvailableVars()
  const {
    readOnly,
    inputs,
    filterVar,
    filterNumberVar,
    handleAddCase,
    handleRemoveCase,
    handleSortCase,
    handleAddCondition,
    handleUpdateCondition,
    handleRemoveCondition,
    handleUpdateConditionLogicalOperator,
    nodesOutputVars,
    availableNodes,
  } = useConfig(id, data)
  const [willDeleteCaseId, setWillDeleteCaseId] = useState('')
  const cases = inputs.cases || []
  const casesLength = cases.length

  return (
    <div className='p-1'>
      <ReactSortable
        list={cases.map(caseItem => ({ ...caseItem, id: caseItem.case_id }))}
        setList={handleSortCase}
        handle='.handle'
        ghostClass='bg-components-panel-bg'
        animation={150}
      >
        {
          cases.map((item, index) => (
            <div key={item.case_id}>
              <div
                className={cn(
                  'group relative py-1 px-3 min-h-[40px] rounded-[10px] bg-components-panel-bg',
                  willDeleteCaseId === item.case_id && 'bg-state-destructive-hover',
                )}
              >
                <RiDraggable className={cn(
                  'hidden handle absolute top-2 left-1 w-3 h-3 text-text-quaternary cursor-pointer',
                  casesLength > 1 && 'group-hover:block',
                )} />
                <div className={cn(
                  'absolute left-4 leading-4 text-[13px] font-semibold text-text-secondary',
                  casesLength === 1 ? 'top-2.5' : 'top-1',
                )}>
                  {
                    index === 0 ? 'IF' : 'ELIF'
                  }
                  {
                    casesLength > 1 && (
                      <div className='text-[10px] text-text-tertiary font-medium'>CASE {index + 1}</div>
                    )
                  }
                </div>
                {
                  !!item.conditions.length && (
                    <div className='mb-2'>
                      <ConditionList
                        disabled={readOnly}
                        caseItem={item}
                        onUpdateCondition={handleUpdateCondition}
                        onRemoveCondition={handleRemoveCondition}
                        onUpdateConditionLogicalOperator={handleUpdateConditionLogicalOperator}
                        nodesOutputVars={nodesOutputVars}
                        availableNodes={availableNodes}
                        numberVariables={getAvailableVars(id, '', filterNumberVar)}
                      />
                    </div>
                  )
                }
                <div className={cn(
                  'flex items-center justify-between pl-[60px] pr-[30px]',
                  !item.conditions.length && 'mt-1',
                )}>
                  <ConditionAdd
                    disabled={readOnly}
                    caseId={item.case_id}
                    variables={getAvailableVars(id, '', filterVar)}
                    onSelectVariable={handleAddCondition}
                  />
                  {
                    ((index === 0 && casesLength > 1) || (index > 0)) && (
                      <Button
                        className='hover:text-components-button-destructive-ghost-text hover:bg-components-button-destructive-ghost-bg-hover'
                        size='small'
                        variant='ghost'
                        disabled={readOnly}
                        onClick={() => handleRemoveCase(item.case_id)}
                        onMouseEnter={() => setWillDeleteCaseId(item.case_id)}
                        onMouseLeave={() => setWillDeleteCaseId('')}
                      >
                        <RiDeleteBinLine className='mr-1 w-3.5 h-3.5' />
                        {t('common.operation.remove')}
                      </Button>
                    )
                  }
                </div>
              </div>
              <div className='my-2 mx-3 h-[1px] bg-divider-subtle'></div>
            </div>
          ))
        }
      </ReactSortable>
      <div className='px-4 py-2'>
        <Button
          className='w-full'
          variant='tertiary'
          onClick={() => handleAddCase()}
          disabled={readOnly}
        >
          <RiAddLine className='mr-1 w-4 h-4' />
          ELIF
        </Button>
      </div>
      <div className='my-2 mx-3 h-[1px] bg-divider-subtle'></div>
      <Field
        title={t(`${i18nPrefix}.else`)}
        className='px-4 py-2'
      >
        <div className='leading-[18px] text-xs font-normal text-text-tertiary'>{t(`${i18nPrefix}.elseDescription`)}</div>
      </Field>
    </div>
  )
}

export default memo(Panel)
