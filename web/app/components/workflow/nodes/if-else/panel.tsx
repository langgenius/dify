import type { FC } from 'react'
import type { IfElseNodeType } from './types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import {
  RiAddLine,
} from '@remixicon/react'
import {
  memo,
} from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import ConditionWrap from './components/condition-wrap'
import useConfig from './use-config'

const i18nPrefix = 'nodes.ifElse'

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
    <div className="p-1">
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
      <div className="px-4 py-2">
        <Button
          className="w-full"
          variant="tertiary"
          onClick={() => handleAddCase()}
          disabled={readOnly}
        >
          <RiAddLine className="mr-1 h-4 w-4" />
          ELIF
        </Button>
      </div>
      <div className="mx-3 my-2 h-px bg-divider-subtle"></div>
      <Field
        title={t(`${i18nPrefix}.else`, { ns: 'workflow' })}
        className="px-4 py-2"
      >
        <div className="text-xs font-normal leading-[18px] text-text-tertiary">{t(`${i18nPrefix}.elseDescription`, { ns: 'workflow' })}</div>
      </Field>
    </div>
  )
}

export default memo(Panel)
