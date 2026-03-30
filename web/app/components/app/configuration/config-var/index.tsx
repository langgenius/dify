'use client'
import type { FC } from 'react'
import type { PromptVariable } from '@/models/debug'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ReactSortable } from 'react-sortablejs'
import Confirm from '@/app/components/base/confirm'
import Tooltip from '@/app/components/base/tooltip'
import { cn } from '@/utils/classnames'
import Panel from '../base/feature-panel'
import EditModal from './config-modal'
import SelectVarType from './select-var-type'
import { useConfigVarState } from './use-config-var-state'
import VarItem from './var-item'

export { ADD_EXTERNAL_DATA_TOOL } from './helpers'

export type IConfigVarProps = {
  promptVariables: PromptVariable[]
  readonly?: boolean
  onPromptVariablesChange?: (promptVariables: PromptVariable[]) => void
}

const ConfigVar: FC<IConfigVarProps> = ({ promptVariables, readonly, onPromptVariablesChange }) => {
  const { t } = useTranslation()
  const {
    canDrag,
    currItemToEdit,
    handleAddVar,
    handleConfig,
    handleDeleteContextVarConfirm,
    handleEditConfirm,
    handleRemoveVar,
    handleSort,
    hasVar,
    hideDeleteContextVarModal,
    hideEditModal,
    isShowDeleteContextVarModal,
    isShowEditModal,
    promptVariablesWithIds,
    removeIndex,
  } = useConfigVarState({
    promptVariables,
    readonly,
    onPromptVariablesChange,
  })

  return (
    <Panel
      className="mt-2"
      title={(
        <div className="flex items-center">
          <div className="mr-1">{t('variableTitle', { ns: 'appDebug' })}</div>
          {!readonly && (
            <Tooltip
              popupContent={(
                <div className="w-[180px]">
                  {t('variableTip', { ns: 'appDebug' })}
                </div>
              )}
            />
          )}
        </div>
      )}
      headerRight={!readonly ? <SelectVarType onChange={handleAddVar} /> : null}
      noBodySpacing
    >
      {!hasVar && (
        <div className="mt-1 px-3 pb-3">
          <div className="pb-1 pt-2 text-xs text-text-tertiary">{t('notSetVar', { ns: 'appDebug' })}</div>
        </div>
      )}
      {hasVar && (
        <div className={cn('mt-1 grid px-3 pb-3')}>
          <ReactSortable
            className={cn('grid-col-1 grid space-y-1', readonly && 'grid-cols-2 gap-1 space-y-0')}
            list={promptVariablesWithIds}
            setList={handleSort}
            handle=".handle"
            ghostClass="opacity-50"
            animation={150}
          >
            {promptVariablesWithIds.map((item, index) => {
              const { key, name, type, required, config, icon, icon_background } = item.variable
              return (
                <VarItem
                  className={cn(canDrag && 'handle')}
                  key={key}
                  readonly={readonly}
                  name={key}
                  label={name}
                  required={!!required}
                  type={type}
                  onEdit={() => handleConfig({ type, key, index, name, config, icon, icon_background })}
                  onRemove={() => handleRemoveVar(index)}
                  canDrag={canDrag}
                />
              )
            })}
          </ReactSortable>
        </div>
      )}

      {isShowEditModal && (
        <EditModal
          payload={currItemToEdit!}
          isShow={isShowEditModal}
          onClose={hideEditModal}
          onConfirm={handleEditConfirm}
          varKeys={promptVariables.map(v => v.key)}
        />
      )}

      {isShowDeleteContextVarModal && (
        <Confirm
          isShow={isShowDeleteContextVarModal}
          title={t('feature.dataSet.queryVariable.deleteContextVarTitle', { ns: 'appDebug', varName: promptVariables[removeIndex as number]?.name })}
          content={t('feature.dataSet.queryVariable.deleteContextVarTip', { ns: 'appDebug' })}
          onConfirm={handleDeleteContextVarConfirm}
          onCancel={hideDeleteContextVarModal}
        />
      )}

    </Panel>
  )
}
export default React.memo(ConfigVar)
