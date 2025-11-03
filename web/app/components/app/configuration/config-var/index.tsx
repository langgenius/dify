'use client'
import type { FC } from 'react'
import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
import { useContext } from 'use-context-selector'
import { produce } from 'immer'
import { ReactSortable } from 'react-sortablejs'
import Panel from '../base/feature-panel'
import EditModal from './config-modal'
import VarItem from './var-item'
import SelectVarType from './select-var-type'
import Tooltip from '@/app/components/base/tooltip'
import type { PromptVariable } from '@/models/debug'
import { DEFAULT_VALUE_MAX_LEN } from '@/config'
import { getNewVar, hasDuplicateStr } from '@/utils/var'
import Toast from '@/app/components/base/toast'
import Confirm from '@/app/components/base/confirm'
import ConfigContext from '@/context/debug-configuration'
import { AppType } from '@/types/app'
import type { ExternalDataTool } from '@/models/common'
import { useModalContext } from '@/context/modal-context'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import type { InputVar } from '@/app/components/workflow/types'
import { InputVarType } from '@/app/components/workflow/types'
import cn from '@/utils/classnames'

export const ADD_EXTERNAL_DATA_TOOL = 'ADD_EXTERNAL_DATA_TOOL'

type ExternalDataToolParams = {
  key: string
  type: string
  index: number
  name: string
  config?: Record<string, any>
  icon?: string
  icon_background?: string
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
  const currItemToEdit: InputVar | null = (() => {
    if (!currItem)
      return null

    return {
      ...currItem,
      label: currItem.name,
      variable: currItem.key,
      type: currItem.type === 'string' ? InputVarType.textInput : currItem.type,
    } as InputVar
  })()
  const updatePromptVariableItem = (payload: InputVar) => {
    const newPromptVariables = produce(promptVariables, (draft) => {
      const { variable, label, type, ...rest } = payload
      draft[currIndex] = {
        ...rest,
        type: type === InputVarType.textInput ? 'string' : type,
        key: variable,
        name: label as string,
      }

      if (payload.type === InputVarType.textInput)
        draft[currIndex].max_length = draft[currIndex].max_length || DEFAULT_VALUE_MAX_LEN

      if (payload.type !== InputVarType.select)
        delete draft[currIndex].options
    })

    const newList = newPromptVariables
    let errorMsgKey = ''
    let typeName = ''
    if (hasDuplicateStr(newList.map(item => item.key))) {
      errorMsgKey = 'appDebug.varKeyError.keyAlreadyExists'
      typeName = 'appDebug.variableConfig.varName'
    }
    else if (hasDuplicateStr(newList.map(item => item.name as string))) {
      errorMsgKey = 'appDebug.varKeyError.keyAlreadyExists'
      typeName = 'appDebug.variableConfig.labelName'
    }

    if (errorMsgKey) {
      Toast.notify({
        type: 'error',
        message: t(errorMsgKey, { key: t(typeName) }),
      })
      return false
    }

    onPromptVariablesChange?.(newPromptVariables)
    return true
  }

  const { setShowExternalDataToolModal } = useModalContext()

  const handleOpenExternalDataToolModal = (
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
            Toast.notify({ type: 'error', message: t('appDebug.varKeyError.keyAlreadyExists', { key: promptVariables[i].key }) })
            return false
          }
        }

        return true
      },
    })
  }

  const handleAddVar = (type: string) => {
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
  }

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
  const didRemoveVar = (index: number) => {
    onPromptVariablesChange?.(promptVariables.filter((_, i) => i !== index))
  }

  const handleRemoveVar = (index: number) => {
    const removeVar = promptVariables[index]

    if (mode === AppType.completion && dataSets.length > 0 && removeVar.is_context_var) {
      showDeleteContextVarModal()
      setRemoveIndex(index)
      return
    }
    didRemoveVar(index)
  }

  // const [currKey, setCurrKey] = useState<string | null>(null)
  const [isShowEditModal, { setTrue: showEditModal, setFalse: hideEditModal }] = useBoolean(false)

  const handleConfig = ({ key, type, index, name, config, icon, icon_background }: ExternalDataToolParams) => {
    // setCurrKey(key)
    setCurrIndex(index)
    if (type !== 'string' && type !== 'paragraph' && type !== 'select' && type !== 'number' && type !== 'checkbox') {
      handleOpenExternalDataToolModal({ key, type, index, name, config, icon, icon_background }, promptVariables)
      return
    }

    showEditModal()
  }

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
      title={
        <div className='flex items-center'>
          <div className='mr-1'>{t('appDebug.variableTitle')}</div>
          {!readonly && (
            <Tooltip
              popupContent={
                <div className='w-[180px]'>
                  {t('appDebug.variableTip')}
                </div>
              }
            />
          )}
        </div>
      }
      headerRight={!readonly ? <SelectVarType onChange={handleAddVar} /> : null}
      noBodySpacing
    >
      {!hasVar && (
        <div className='mt-1 px-3 pb-3'>
          <div className='pb-1 pt-2 text-xs text-text-tertiary'>{t('appDebug.notSetVar')}</div>
        </div>
      )}
      {hasVar && (
        <div className='mt-1 px-3 pb-3'>
          <ReactSortable
            className='space-y-1'
            list={promptVariablesWithIds}
            setList={(list) => { onPromptVariablesChange?.(list.map(item => item.variable)) }}
            handle='.handle'
            ghostClass='opacity-50'
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
            if (!isValid) return
            hideEditModal()
          }}
          varKeys={promptVariables.map(v => v.key)}
        />
      )}

      {isShowDeleteContextVarModal && (
        <Confirm
          isShow={isShowDeleteContextVarModal}
          title={t('appDebug.feature.dataSet.queryVariable.deleteContextVarTitle', { varName: promptVariables[removeIndex as number]?.name })}
          content={t('appDebug.feature.dataSet.queryVariable.deleteContextVarTip')}
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
