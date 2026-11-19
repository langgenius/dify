import type { FC } from 'react'
import type { LogicalOperator } from '../../if-else/types'
import type { Outcome } from '../types'
import type { DecisionConfig } from '../use-config'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Input } from '@langgenius/dify-ui/input'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import AddButton from '@/app/components/workflow/nodes/_base/components/add-button'
import Editor from '@/app/components/workflow/nodes/_base/components/prompt/editor'
import { useGetAvailableVars } from '@/app/components/workflow/nodes/variable-assigner/hooks'
import ConditionAdd from '../../if-else/components/condition-add'
import ConditionList from '../../if-else/components/condition-list'

const i18nPrefix = 'nodes.decision'

type OutcomeListProps = {
  nodeId: string
  config: DecisionConfig
}

// The If-Else condition editor addresses a rule group as a "case"; the outcome
// id doubles as the case id so the components are reused unmodified.
const toCaseItemView = (outcome: Outcome) => {
  const when =
    typeof outcome.when === 'object' && outcome.when !== null
      ? outcome.when
      : { logical_operator: 'and' as LogicalOperator, conditions: [] }

  return {
    case_id: outcome.id,
    logical_operator: when.logical_operator as LogicalOperator,
    conditions: when.conditions,
  }
}

const OutcomeList: FC<OutcomeListProps> = ({ nodeId, config }) => {
  const { t } = useTranslation(['common', 'workflow'])
  const reactId = useId()
  const getAvailableVars = useGetAvailableVars()
  const {
    readOnly,
    inputs,
    isRulesMode,
    filterVar,
    filterNumberVar,
    handleAddOutcome,
    handleRemoveOutcome,
    handleUpdateOutcomeLabel,
    handleUpdateOutcomeWhenText,
    handleAddCondition,
    handleRemoveCondition,
    handleUpdateCondition,
    handleToggleConditionLogicalOperator,
    handleAddSubVariableCondition,
    handleRemoveSubVariableCondition,
    handleUpdateSubVariableCondition,
    handleToggleSubVariableConditionLogicalOperator,
    nodesOutputVars,
    availableNodes,
    varsIsVarFileAttribute,
  } = config

  return (
    <div className="space-y-2 px-4">
      {inputs.outcomes.map((outcome) => {
        const caseItem = toCaseItemView(outcome)

        return (
          <div
            key={outcome.id}
            className="relative rounded-[10px] bg-components-panel-bg px-3 py-2"
          >
            <div className="flex items-center gap-1">
              <Input
                className="h-7 grow text-xs font-semibold"
                value={outcome.label}
                disabled={readOnly}
                aria-label={t(($) => $[`${i18nPrefix}.outcomeLabel`], { ns: 'workflow' })}
                placeholder={t(($) => $[`${i18nPrefix}.outcomeLabelPlaceholder`], {
                  ns: 'workflow',
                })}
                onChange={(e) => handleUpdateOutcomeLabel(outcome.id, e.target.value)}
              />
              <IconButton
                size="sm"
                variant="ghost"
                disabled={readOnly || inputs.outcomes.length <= 1}
                aria-label={t(($) => $['operation.remove'], { ns: 'common' })}
                onClick={() => handleRemoveOutcome(outcome.id)}
              >
                <span aria-hidden="true" className="i-ri-delete-bin-line size-3.5" />
              </IconButton>
            </div>
            {isRulesMode ? (
              <>
                {!!caseItem.conditions.length && (
                  <div className="mt-2">
                    <ConditionList
                      disabled={readOnly}
                      caseId={outcome.id}
                      caseItem={caseItem}
                      onUpdateCondition={handleUpdateCondition}
                      onRemoveCondition={handleRemoveCondition}
                      onToggleConditionLogicalOperator={handleToggleConditionLogicalOperator}
                      nodeId={nodeId}
                      nodesOutputVars={nodesOutputVars}
                      availableNodes={availableNodes}
                      numberVariables={getAvailableVars(nodeId, '', filterNumberVar)}
                      varsIsVarFileAttribute={varsIsVarFileAttribute}
                      onAddSubVariableCondition={handleAddSubVariableCondition}
                      onRemoveSubVariableCondition={handleRemoveSubVariableCondition}
                      onUpdateSubVariableCondition={handleUpdateSubVariableCondition}
                      onToggleSubVariableConditionLogicalOperator={
                        handleToggleSubVariableConditionLogicalOperator
                      }
                      filterVar={filterVar}
                    />
                  </div>
                )}
                <div className="mt-1">
                  <ConditionAdd
                    disabled={readOnly}
                    caseId={outcome.id}
                    variables={getAvailableVars(nodeId, '', filterVar)}
                    onSelectVariable={handleAddCondition}
                  />
                </div>
              </>
            ) : (
              <div className="mt-2">
                <Editor
                  instanceId={`${nodeId}-${reactId}-${outcome.id}`}
                  title={t(($) => $[`${i18nPrefix}.whenDescription`], { ns: 'workflow' })}
                  placeholder={t(($) => $[`${i18nPrefix}.whenPlaceholder`], { ns: 'workflow' })!}
                  value={typeof outcome.when === 'string' ? outcome.when : ''}
                  onChange={(value) => handleUpdateOutcomeWhenText(outcome.id, value)}
                  nodesOutputVars={nodesOutputVars}
                  availableNodes={availableNodes}
                  readOnly={readOnly}
                  justVar
                  isSupportFileVar
                />
              </div>
            )}
          </div>
        )
      })}
      {!readOnly && (
        <AddButton
          onClick={handleAddOutcome}
          text={t(($) => $[`${i18nPrefix}.addOutcome`], { ns: 'workflow' })}
        />
      )}
    </div>
  )
}

export default OutcomeList
