import type { FC } from 'react'
import {
  memo,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiAddLine,
} from '@remixicon/react'
import useConfig from './use-config'
import type { IfElseNodeType } from './types'
import ConditionWrap from './components/condition-wrap'
import Button from '@/app/components/base/button'
import type { NodePanelProps } from '@/app/components/workflow/types'
import Field from '@/app/components/workflow/nodes/_base/components/field'

const i18nPrefix = 'workflow.nodes.ifElse'

const Panel: FC<NodePanelProps<IfElseNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()
  const {
    readOnly,
    inputs,
    filterVar,
    handleAddCase,
    handleRemoveCase,
    handleSortCase,
    handleAddCondition,
    handleUpdateCondition,
    handleRemoveCondition,
    handleToggleConditionLogicalOperator,
    handleAddSubVariableCondition,
    handleRemoveSubVariableCondition,
    handleUpdateSubVariableCondition,
    handleToggleSubVariableConditionLogicalOperator,
    nodesOutputVars,
    availableNodes,
    varsIsVarFileAttribute,
  } = useConfig(id, data)
  const cases = inputs.cases || []

  return (
    <div className='p-1'>
      <ConditionWrap
        nodeId={id}
        cases={cases}
        readOnly={readOnly}
        handleSortCase={handleSortCase}
        handleRemoveCase={handleRemoveCase}
        handleAddCondition={handleAddCondition}
        handleRemoveCondition={handleRemoveCondition}
        handleUpdateCondition={handleUpdateCondition}
        handleToggleConditionLogicalOperator={handleToggleConditionLogicalOperator}
        handleAddSubVariableCondition={handleAddSubVariableCondition}
        handleRemoveSubVariableCondition={handleRemoveSubVariableCondition}
        handleUpdateSubVariableCondition={handleUpdateSubVariableCondition}
        handleToggleSubVariableConditionLogicalOperator={handleToggleSubVariableConditionLogicalOperator}
        nodesOutputVars={nodesOutputVars}
        availableNodes={availableNodes}
        varsIsVarFileAttribute={varsIsVarFileAttribute}
        filterVar={filterVar}
      />
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
