import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import Field from '../_base/components/field'
import RemoveEffectVarConfirm from '../_base/components/remove-effect-var-confirm'
import useConfig from './use-config'
import type { VariableAssignerNodeType } from './types'
import VarGroupItem from './components/var-group-item'
import cn from '@/utils/classnames'
import { type NodePanelProps } from '@/app/components/workflow/types'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import OutputVars, { VarItem } from '@/app/components/workflow/nodes/_base/components/output-vars'
import Switch from '@/app/components/base/switch'
import AddButton from '@/app/components/workflow/nodes/_base/components/add-button'

const i18nPrefix = 'workflow.nodes.variableAssigner'
const Panel: FC<NodePanelProps<VariableAssignerNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()

  const {
    readOnly,
    inputs,
    handleListOrTypeChange,
    isEnableGroup,
    handleGroupEnabledChange,
    handleAddGroup,
    handleListOrTypeChangeInGroup,
    handleGroupRemoved,
    handleVarGroupNameChange,
    isShowRemoveVarConfirm,
    hideRemoveVarConfirm,
    onRemoveVarConfirm,
    getAvailableVars,
    filterVar,
  } = useConfig(id, data)

  return (
    <div className='mt-2'>
      <div className='px-4 pb-4 space-y-4'>
        {!isEnableGroup
          ? (
            <VarGroupItem
              readOnly={readOnly}
              nodeId={id}
              payload={{
                output_type: inputs.output_type,
                variables: inputs.variables,
              }}
              onChange={handleListOrTypeChange}
              groupEnabled={false}
              availableVars={getAvailableVars(id, 'target', filterVar(inputs.output_type), true)}
            />
          )
          : (<div>
            <div className='space-y-2'>
              {inputs.advanced_settings?.groups.map((item, index) => (
                <div key={item.groupId}>
                  <VarGroupItem
                    readOnly={readOnly}
                    nodeId={id}
                    payload={item}
                    onChange={handleListOrTypeChangeInGroup(item.groupId)}
                    groupEnabled
                    canRemove={!readOnly && inputs.advanced_settings?.groups.length > 1}
                    onRemove={handleGroupRemoved(item.groupId)}
                    onGroupNameChange={handleVarGroupNameChange(item.groupId)}
                    availableVars={getAvailableVars(id, item.groupId, filterVar(item.output_type), true)}
                  />
                  {index !== inputs.advanced_settings?.groups.length - 1 && <Split className='my-4' />}
                </div>

              ))}
            </div>
            <AddButton
              className='mt-2'
              text={t(`${i18nPrefix}.addGroup`)}
              onClick={handleAddGroup}
            />
          </div>)}
      </div>
      <Split />
      <div className={cn('px-4 pt-4', isEnableGroup ? 'pb-4' : 'pb-2')}>
        <Field
          title={t(`${i18nPrefix}.aggregationGroup`)}
          tooltip={t(`${i18nPrefix}.aggregationGroupTip`)!}
          operations={
            <Switch
              defaultValue={isEnableGroup}
              onChange={handleGroupEnabledChange}
              size='md'
              disabled={readOnly}
            />
          }
        />
      </div>
      {isEnableGroup && (
        <>
          <Split />
          <div className='px-4 pt-4 pb-2'>
            <OutputVars>
              <>
                {inputs.advanced_settings?.groups.map((item, index) => (
                  <VarItem
                    key={index}
                    name={`${item.group_name}.output`}
                    type={item.output_type}
                    description={t(`${i18nPrefix}.outputVars.varDescribe`, {
                      groupName: item.group_name,
                    })}
                  />
                ))}
              </>
            </OutputVars>
          </div>
        </>
      )}
      <RemoveEffectVarConfirm
        isShow={isShowRemoveVarConfirm}
        onCancel={hideRemoveVarConfirm}
        onConfirm={onRemoveVarConfirm}
      />
    </div>
  )
}

export default React.memo(Panel)
