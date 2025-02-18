'use client'
import type { FC } from 'react'
import React from 'react'
import copy from 'copy-to-clipboard'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { useBoolean } from 'ahooks'
import produce from 'immer'
import {
  RiDeleteBinLine,
  RiErrorWarningFill,
} from '@remixicon/react'
import s from './style.module.css'
import MessageTypeSelector from './message-type-selector'
import ConfirmAddVar from './confirm-add-var'
import PromptEditorHeightResizeWrap from './prompt-editor-height-resize-wrap'
import cn from '@/utils/classnames'
import type { PromptRole, PromptVariable } from '@/models/debug'
import {
  Clipboard,
  ClipboardCheck,
} from '@/app/components/base/icons/src/vender/line/files'
import Tooltip from '@/app/components/base/tooltip'
import PromptEditor from '@/app/components/base/prompt-editor'
import ConfigContext from '@/context/debug-configuration'
import { getNewVar, getVars } from '@/utils/var'
import { AppType } from '@/types/app'
import { useModalContext } from '@/context/modal-context'
import type { ExternalDataTool } from '@/models/common'
import { useToastContext } from '@/app/components/base/toast'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { ADD_EXTERNAL_DATA_TOOL } from '@/app/components/app/configuration/config-var'
import { INSERT_VARIABLE_VALUE_BLOCK_COMMAND } from '@/app/components/base/prompt-editor/plugins/variable-block'
type Props = {
  type: PromptRole
  isChatMode: boolean
  value: string
  onTypeChange: (value: PromptRole) => void
  onChange: (value: string) => void
  canDelete: boolean
  onDelete: () => void
  promptVariables: PromptVariable[]
  isContextMissing: boolean
  onHideContextMissingTip: () => void
  noResize?: boolean
}

const AdvancedPromptInput: FC<Props> = ({
  type,
  isChatMode,
  value,
  onChange,
  onTypeChange,
  canDelete,
  onDelete,
  promptVariables,
  isContextMissing,
  onHideContextMissingTip,
  noResize,
}) => {
  const { t } = useTranslation()
  const { eventEmitter } = useEventEmitterContextContext()

  const {
    mode,
    hasSetBlockStatus,
    modelConfig,
    setModelConfig,
    conversationHistoriesRole,
    showHistoryModal,
    dataSets,
    showSelectDataSet,
    externalDataToolsConfig,
  } = useContext(ConfigContext)
  const { notify } = useToastContext()
  const { setShowExternalDataToolModal } = useModalContext()
  const handleOpenExternalDataToolModal = () => {
    setShowExternalDataToolModal({
      payload: {},
      onSaveCallback: (newExternalDataTool: ExternalDataTool) => {
        eventEmitter?.emit({
          type: ADD_EXTERNAL_DATA_TOOL,
          payload: newExternalDataTool,
        } as any)
        eventEmitter?.emit({
          type: INSERT_VARIABLE_VALUE_BLOCK_COMMAND,
          payload: newExternalDataTool.variable,
        } as any)
      },
      onValidateBeforeSaveCallback: (newExternalDataTool: ExternalDataTool) => {
        for (let i = 0; i < promptVariables.length; i++) {
          if (promptVariables[i].key === newExternalDataTool.variable) {
            notify({ type: 'error', message: t('appDebug.varKeyError.keyAlreadyExists', { key: promptVariables[i].key }) })
            return false
          }
        }

        return true
      },
    })
  }
  const isChatApp = mode !== AppType.completion
  const [isCopied, setIsCopied] = React.useState(false)

  const promptVariablesObj = (() => {
    const obj: Record<string, boolean> = {}
    promptVariables.forEach((item) => {
      obj[item.key] = true
    })
    return obj
  })()
  const [newPromptVariables, setNewPromptVariables] = React.useState<PromptVariable[]>(promptVariables)
  const [isShowConfirmAddVar, { setTrue: showConfirmAddVar, setFalse: hideConfirmAddVar }] = useBoolean(false)
  const handlePromptChange = (newValue: string) => {
    if (value === newValue)
      return
    onChange(newValue)
  }
  const handleBlur = () => {
    const keys = getVars(value)
    const newPromptVariables = keys.filter(key => !(key in promptVariablesObj) && !externalDataToolsConfig.find(item => item.variable === key)).map(key => getNewVar(key, ''))
    if (newPromptVariables.length > 0) {
      setNewPromptVariables(newPromptVariables)
      showConfirmAddVar()
    }
  }

  const handleAutoAdd = (isAdd: boolean) => {
    return () => {
      if (isAdd) {
        const newModelConfig = produce(modelConfig, (draft) => {
          draft.configs.prompt_variables = [...draft.configs.prompt_variables, ...newPromptVariables]
        })
        setModelConfig(newModelConfig)
      }
      hideConfirmAddVar()
    }
  }

  const minHeight = 102
  const [editorHeight, setEditorHeight] = React.useState(isChatMode ? 200 : 508)
  const contextMissing = (
    <div
      className='flex h-11 items-center justify-between rounded-tl-xl rounded-tr-xl pb-1 pl-4 pr-3 pt-2'
      style={{
        background: 'linear-gradient(180deg, #FEF0C7 0%, rgba(254, 240, 199, 0) 100%)',
      }}
    >
      <div className='flex items-center pr-2' >
        <RiErrorWarningFill className='mr-1 h-4 w-4 text-[#F79009]' />
        <div className='text-[13px] font-medium leading-[18px] text-[#DC6803]'>{t('appDebug.promptMode.contextMissing')}</div>
      </div>
      <div
        className='shadow-xs text-primary-600 flex h-6 cursor-pointer items-center rounded-md border border-gray-200 bg-[#fff] px-2 text-xs font-medium'
        onClick={onHideContextMissingTip}
      >{t('common.operation.ok')}</div>
    </div>
  )
  return (
    <div className={`relative ${!isContextMissing ? s.gradientBorder : s.warningBorder}`}>
      <div className='rounded-xl bg-white'>
        {isContextMissing
          ? contextMissing
          : (
            <div className={cn(s.boxHeader, 'hover:shadow-xs flex h-11 items-center justify-between rounded-tl-xl rounded-tr-xl bg-white pb-1 pl-4 pr-3 pt-2')}>
              {isChatMode
                ? (
                  <MessageTypeSelector value={type} onChange={onTypeChange} />
                )
                : (
                  <div className='flex items-center space-x-1'>

                    <div className='text-sm font-semibold uppercase text-indigo-800'>{t('appDebug.pageTitle.line1')}
                    </div>
                    <Tooltip
                      popupContent={
                        <div className='w-[180px]'>
                          {t('appDebug.promptTip')}
                        </div>
                      }
                    />
                  </div>)}
              <div className={cn(s.optionWrap, 'items-center space-x-1')}>
                {canDelete && (
                  <RiDeleteBinLine onClick={onDelete} className='h-6 w-6 cursor-pointer p-1 text-gray-500' />
                )}
                {!isCopied
                  ? (
                    <Clipboard className='h-6 w-6 cursor-pointer p-1 text-gray-500' onClick={() => {
                      copy(value)
                      setIsCopied(true)
                    }} />
                  )
                  : (
                    <ClipboardCheck className='h-6 w-6 p-1 text-gray-500' />
                  )}
              </div>
            </div>
          )}

        <PromptEditorHeightResizeWrap
          className='min-h-[102px] overflow-y-auto px-4 text-sm text-gray-700'
          height={editorHeight}
          minHeight={minHeight}
          onHeightChange={setEditorHeight}
          footer={(
            <div className='flex pb-2 pl-4'>
              <div className="h-[18px] rounded-md bg-gray-100 px-1 text-xs leading-[18px] text-gray-500">{value.length}</div>
            </div>
          )}
          hideResize={noResize}
        >
          <PromptEditor
            className='min-h-[84px]'
            value={value}
            contextBlock={{
              show: true,
              selectable: !hasSetBlockStatus.context,
              datasets: dataSets.map(item => ({
                id: item.id,
                name: item.name,
                type: item.data_source_type,
              })),
              onAddContext: showSelectDataSet,
            }}
            variableBlock={{
              show: true,
              variables: modelConfig.configs.prompt_variables.filter(item => item.type !== 'api').map(item => ({
                name: item.name,
                value: item.key,
              })),
            }}
            externalToolBlock={{
              externalTools: modelConfig.configs.prompt_variables.filter(item => item.type === 'api').map(item => ({
                name: item.name,
                variableName: item.key,
                icon: item.icon,
                icon_background: item.icon_background,
              })),
              onAddExternalTool: handleOpenExternalDataToolModal,
            }}
            historyBlock={{
              show: !isChatMode && isChatApp,
              selectable: !hasSetBlockStatus.history,
              history: {
                user: conversationHistoriesRole?.user_prefix,
                assistant: conversationHistoriesRole?.assistant_prefix,
              },
              onEditRole: showHistoryModal,
            }}
            queryBlock={{
              show: !isChatMode && isChatApp,
              selectable: !hasSetBlockStatus.query,
            }}
            onChange={handlePromptChange}
            onBlur={handleBlur}
          />
        </PromptEditorHeightResizeWrap>

      </div>

      {isShowConfirmAddVar && (
        <ConfirmAddVar
          varNameArr={newPromptVariables.map(v => v.name)}
          onConfirm={handleAutoAdd(true)}
          onCancel={handleAutoAdd(false)}
          onHide={hideConfirmAddVar}
        />
      )}
    </div>
  )
}
export default React.memo(AdvancedPromptInput)
