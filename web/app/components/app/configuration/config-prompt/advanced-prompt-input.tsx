'use client'
import type { FC } from 'react'
import React from 'react'
import copy from 'copy-to-clipboard'
import cn from 'classnames'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { useBoolean } from 'ahooks'
import produce from 'immer'
import s from './style.module.css'
import MessageTypeSelector from './message-type-selector'
import ConfirmAddVar from './confirm-add-var'
import type { PromptRole, PromptVariable } from '@/models/debug'
import { HelpCircle, Trash03 } from '@/app/components/base/icons/src/vender/line/general'
import { Clipboard, ClipboardCheck } from '@/app/components/base/icons/src/vender/line/files'
import Tooltip from '@/app/components/base/tooltip'
import PromptEditor from '@/app/components/base/prompt-editor'
import ConfigContext from '@/context/debug-configuration'
import { getNewVar, getVars } from '@/utils/var'
import { AppType } from '@/types/app'

type Props = {
  type: PromptRole
  isChatMode: boolean
  value: string
  onTypeChange: (value: PromptRole) => void
  onChange: (value: string) => void
  canDelete: boolean
  onDelete: () => void
  promptVariables: PromptVariable[]
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
}) => {
  const { t } = useTranslation()

  const {
    mode,
    hasSetBlockStatus,
    modelConfig,
    setModelConfig,
    conversationHistoriesRole,
    showHistoryModal,
    dataSets,
    showSelectDataSet,
  } = useContext(ConfigContext)
  const isChatApp = mode === AppType.chat
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
    const newPromptVariables = keys.filter(key => !(key in promptVariablesObj)).map(key => getNewVar(key))
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

  const editorHeight = isChatMode ? 'h-[200px]' : 'h-[508px]'

  return (
    <div className={`relative ${s.gradientBorder}`}>
      <div className='rounded-xl bg-white'>
        <div className={cn(s.boxHeader, 'flex justify-between items-center h-11 pt-2 pr-3 pb-1 pl-4 rounded-tl-xl rounded-tr-xl bg-white hover:shadow-xs')}>
          {isChatMode
            ? (
              <MessageTypeSelector value={type} onChange={onTypeChange} />
            )
            : (
              <div className='flex items-center space-x-1'>

                <div className='text-sm font-semibold uppercase text-indigo-800'>{t('appDebug.pageTitle.line1')}
                </div>
                <Tooltip
                  htmlContent={<div className='w-[180px]'>
                    {t('appDebug.promptTip')}
                  </div>}
                  selector='config-prompt-tooltip'>
                  <HelpCircle className='w-[14px] h-[14px] text-indigo-400' />
                </Tooltip>
              </div>)}
          <div className={cn(s.optionWrap, 'items-center space-x-1')}>
            {canDelete && (
              <Trash03 onClick={onDelete} className='h-6 w-6 p-1 text-gray-500 cursor-pointer' />
            )}
            {!isCopied
              ? (
                <Clipboard className='h-6 w-6 p-1 text-gray-500 cursor-pointer' onClick={() => {
                  copy(value)
                  setIsCopied(true)
                }} />
              )
              : (
                <ClipboardCheck className='h-6 w-6 p-1 text-gray-500' />
              )}

          </div>
        </div>
        <div className={cn(editorHeight, 'px-4 min-h-[102px] overflow-y-auto text-sm text-gray-700')}>
          <PromptEditor
            className={editorHeight}
            value={value}
            contextBlock={{
              selectable: !hasSetBlockStatus.context,
              datasets: dataSets.map(item => ({
                id: item.id,
                name: item.name,
                type: item.data_source_type,
              })),
              onAddContext: showSelectDataSet,
            }}
            variableBlock={{
              variables: modelConfig.configs.prompt_variables.map(item => ({
                name: item.name,
                value: item.key,
              })),
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
        </div>
        <div className='pl-4 pb-2 flex'>
          <div className="h-[18px] leading-[18px] px-1 rounded-md bg-gray-100 text-xs text-gray-500">{value.length}</div>
        </div>
      </div>

      {isShowConfirmAddVar && (
        <ConfirmAddVar
          varNameArr={newPromptVariables.map(v => v.name)}
          onConfrim={handleAutoAdd(true)}
          onCancel={handleAutoAdd(false)}
          onHide={hideConfirmAddVar}
        />
      )}
    </div>
  )
}
export default React.memo(AdvancedPromptInput)
