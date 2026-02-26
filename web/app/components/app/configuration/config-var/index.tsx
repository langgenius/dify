'use client'
import type { FC } from 'react'
import type { InputVar } from '@/app/components/workflow/types'
import type { ExternalDataTool } from '@/models/common'
import type { PromptVariable } from '@/models/debug'
import type { I18nKeysByPrefix } from '@/types/i18n'
import { useBoolean } from 'ahooks'
import { produce } from 'immer'
import * as React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ReactSortable } from 'react-sortablejs'
import { useContext } from 'use-context-selector'
import Confirm from '@/app/components/base/confirm'
import Toast from '@/app/components/base/toast'
import Tooltip from '@/app/components/base/tooltip'
import { InputVarType } from '@/app/components/workflow/types'
import ConfigContext from '@/context/debug-configuration'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { useModalContext } from '@/context/modal-context'
import { AppModeEnum } from '@/types/app'
import { cn } from '@/utils/classnames'
import { getNewVar, hasDuplicateStr } from '@/utils/var'
import Panel from '../base/feature-panel'
import EditModal from './config-modal'
import SelectVarType from './select-var-type'
import VarItem from './var-item'

export const ADD_EXTERNAL_DATA_TOOL = 'ADD_EXTERNAL_DATA_TOOL'

type ExternalDataToolParams = {
  key: string
  type: string
  index: number
  name: string
  config?: PromptVariable['config']
  icon?: string
  icon_background?: string
}

const BASIC_INPUT_TYPES = new Set(['string', 'paragraph', 'select', 'number', 'checkbox'])

const toInputVar = (item: PromptVariable): InputVar => ({
  ...item,
  label: item.name,
  variable: item.key,
  type: (item.type === 'string' ? InputVarType.textInput : item.type) as InputVarType,
  required: item.required ?? false,
})

const buildPromptVariableFromInput = (payload: InputVar): PromptVariable => {
  const { variable, label, type, ...rest } = payload
  const nextType = type === InputVarType.textInput ? 'string' : type
  const nextItem: PromptVariable = {
    ...rest,
    type: nextType,
    key: variable,
    name: label as string,
  }

  if (payload.type !== InputVarType.select)
    delete nextItem.options

  return nextItem
}

const getDuplicateError = (list: PromptVariable[]) => {
  if (hasDuplicateStr(list.map(item => item.key))) {
    return {
      errorMsgKey: 'varKeyError.keyAlreadyExists',
      typeName: 'variableConfig.varName',
    }
  }
  if (hasDuplicateStr(list.map(item => item.name as string))) {
    return {
      errorMsgKey: 'varKeyError.keyAlreadyExists',
      typeName: 'variableConfig.labelName',
    }
  }
  return null
}

export type IConfigVarProps = {
  promptVariables: PromptVariable[]
  readonly?: boolean
  onPromptVariablesChange?: (promptVariables: PromptVariable[]) => void
}

const ConfigVar: FC<IConfigVarProps> = ({ promptVariables, readonly, onPromptVariablesChange }) => {
  const { t } = useTranslation()
  const {
    mode,
    dataSets,
  } = useContext(ConfigContext)
  const { eventEmitter } = useEventEmitterContextContext()

  const hasVar = promptVariables.length > 0
  const [currIndex, setCurrIndex] = useState<number>(-1)
  const currItem = currIndex !== -1 ? promptVariables[currIndex] : null
  const currItemToEdit = useMemo(() => {
    if (!currItem)
      return null
    return toInputVar(currItem)
  }, [currItem])
  const updatePromptVariableItem = useCallback((payload: InputVar) => {
    const newPromptVariables = produce(promptVariables, (draft) => {
      draft[currIndex] = buildPromptVariableFromInput(payload)
    })
    const duplicateError = getDuplicateError(newPromptVariables)
    if (duplicateError) {
      Toast.notify({
        type: 'error',
        message: t(duplicateError.errorMsgKey as I18nKeysByPrefix<'appDebug', 'duplicateError.'>, { ns: 'appDebug', key: t(duplicateError.typeName as I18nKeysByPrefix<'appDebug', 'duplicateError.'>, { ns: 'appDebug' }) }) as string,
      })
      return false
    }

    onPromptVariablesChange?.(newPromptVariables)
    return true
  }, [currIndex, onPromptVariablesChange, promptVariables, t])

  const { setShowExternalDataToolModal } = useModalContext()

  const handleOpenExternalDataToolModal = useCallback((
    { key, type, index, name, config, icon, icon_background }: ExternalDataToolParams,
    oldPromptVariables: PromptVariable[],
  ) => {
    setShowExternalDataToolModal({
      payload: {
        type,
        variable: key,
        label: name,
        config,
        icon,
        icon_background,
      },
      onSaveCallback: (newExternalDataTool?: ExternalDataTool) => {
        if (!newExternalDataTool)
          return
        const newPromptVariables = oldPromptVariables.map((item, i) => {
          if (i === index) {
            return {
              key: newExternalDataTool.variable as string,
              name: newExternalDataTool.label as string,
              enabled: newExternalDataTool.enabled,
              type: newExternalDataTool.type as string,
              config: newExternalDataTool.config,
              required: item.required,
              icon: newExternalDataTool.icon,
              icon_background: newExternalDataTool.icon_background,
            }
          }
          return item
        })
        onPromptVariablesChange?.(newPromptVariables)
      },
      onCancelCallback: () => {
        if (!key)
          onPromptVariablesChange?.(promptVariables.filter((_, i) => i !== index))
      },
      onValidateBeforeSaveCallback: (newExternalDataTool: ExternalDataTool) => {
        for (let i = 0; i < promptVariables.length; i++) {
          if (promptVariables[i].key === newExternalDataTool.variable && i !== index) {
            Toast.notify({ type: 'error', message: t('varKeyError.keyAlreadyExists', { ns: 'appDebug', key: promptVariables[i].key }) })
            return false
          }
        }

        return true
      },
    })
  }, [onPromptVariablesChange, promptVariables, setShowExternalDataToolModal, t])

  const handleAddVar = useCallback((type: string) => {
    const newVar = getNewVar('', type)
    const newPromptVariables = [...promptVariables, newVar]
    onPromptVariablesChange?.(newPromptVariables)

    if (type === 'api') {
      handleOpenExternalDataToolModal({
        type,
        key: newVar.key,
        name: newVar.name,
        index: promptVariables.length,
      }, newPromptVariables)
    }
  }, [handleOpenExternalDataToolModal, onPromptVariablesChange, promptVariables])

  // eslint-disable-next-line ts/no-explicit-any
  eventEmitter?.useSubscription((v: any) => {
    if (v.type === ADD_EXTERNAL_DATA_TOOL) {
      const payload = v.payload
      onPromptVariablesChange?.([
        ...promptVariables,
        {
          key: payload.variable as string,
          name: payload.label as string,
          enabled: payload.enabled,
          type: payload.type as string,
          config: payload.config,
          required: true,
          icon: payload.icon,
          icon_background: payload.icon_background,
        },
      ])
    }
  })

  const [isShowDeleteContextVarModal, { setTrue: showDeleteContextVarModal, setFalse: hideDeleteContextVarModal }] = useBoolean(false)
  const [removeIndex, setRemoveIndex] = useState<number | null>(null)
  const didRemoveVar = useCallback((index: number) => {
    onPromptVariablesChange?.(promptVariables.filter((_, i) => i !== index))
  }, [onPromptVariablesChange, promptVariables])

  const handleRemoveVar = useCallback((index: number) => {
    const removeVar = promptVariables[index]

    if (mode === AppModeEnum.COMPLETION && dataSets.length > 0 && removeVar.is_context_var) {
      showDeleteContextVarModal()
      setRemoveIndex(index)
      return
    }
    didRemoveVar(index)
  }, [dataSets.length, didRemoveVar, mode, promptVariables, showDeleteContextVarModal])

  const [isShowEditModal, { setTrue: showEditModal, setFalse: hideEditModal }] = useBoolean(false)

  const handleConfig = useCallback(({ key, type, index, name, config, icon, icon_background }: ExternalDataToolParams) => {
    // setCurrKey(key)
    setCurrIndex(index)
    if (!BASIC_INPUT_TYPES.has(type)) {
      handleOpenExternalDataToolModal({ key, type, index, name, config, icon, icon_background }, promptVariables)
      return
    }

    showEditModal()
  }, [handleOpenExternalDataToolModal, promptVariables, showEditModal])

  const promptVariablesWithIds = useMemo(() => promptVariables.map((item) => {
    return {
      id: item.key,
      variable: { ...item },
    }
  }), [promptVariables])

  const canDrag = !readonly && promptVariables.length > 1

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
            setList={(list) => { onPromptVariablesChange?.(list.map(item => item.variable)) }}
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
          onConfirm={(item) => {
            const isValid = updatePromptVariableItem(item)
            if (!isValid)
              return
            hideEditModal()
          }}
          varKeys={promptVariables.map(v => v.key)}
        />
      )}

      {isShowDeleteContextVarModal && (
        <Confirm
          isShow={isShowDeleteContextVarModal}
          title={t('feature.dataSet.queryVariable.deleteContextVarTitle', { ns: 'appDebug', varName: promptVariables[removeIndex as number]?.name })}
          content={t('feature.dataSet.queryVariable.deleteContextVarTip', { ns: 'appDebug' })}
          onConfirm={() => {
            didRemoveVar(removeIndex as number)
            hideDeleteContextVarModal()
          }}
          onCancel={hideDeleteContextVarModal}
        />
      )}

    </Panel>
  )
}
export default React.memo(ConfigVar)
