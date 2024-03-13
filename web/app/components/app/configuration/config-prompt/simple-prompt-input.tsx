'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
import cn from 'classnames'
import produce from 'immer'
import { useContext } from 'use-context-selector'
import ConfirmAddVar from './confirm-add-var'
import s from './style.module.css'
import PromptEditorHeightResizeWrap from './prompt-editor-height-resize-wrap'
import { PromptMode, type PromptVariable } from '@/models/debug'
import Tooltip from '@/app/components/base/tooltip'
import { AppType } from '@/types/app'
import { getNewVar, getVars } from '@/utils/var'
import { HelpCircle } from '@/app/components/base/icons/src/vender/line/general'
import AutomaticBtn from '@/app/components/app/configuration/config/automatic/automatic-btn'
import type { AutomaticRes } from '@/service/debug'
import GetAutomaticResModal from '@/app/components/app/configuration/config/automatic/get-automatic-res'
import PromptEditor from '@/app/components/base/prompt-editor'
import ConfigContext from '@/context/debug-configuration'
import { useModalContext } from '@/context/modal-context'
import type { ExternalDataTool } from '@/models/common'
import { useToastContext } from '@/app/components/base/toast'
import { ArrowNarrowRight } from '@/app/components/base/icons/src/vender/line/arrows'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { ADD_EXTERNAL_DATA_TOOL } from '@/app/components/app/configuration/config-var'
import { INSERT_VARIABLE_VALUE_BLOCK_COMMAND } from '@/app/components/base/prompt-editor/plugins/variable-block'
import { PROMPT_EDITOR_UPDATE_VALUE_BY_EVENT_EMITTER } from '@/app/components/base/prompt-editor/plugins/update-block'

export type ISimplePromptInput = {
  mode: AppType
  promptTemplate: string
  promptVariables: PromptVariable[]
  readonly?: boolean
  onChange?: (promp: string, promptVariables: PromptVariable[]) => void
}

const Prompt: FC<ISimplePromptInput> = ({
  mode,
  promptTemplate,
  promptVariables,
  readonly = false,
  onChange,
}) => {
  const { t } = useTranslation()
  const { eventEmitter } = useEventEmitterContextContext()
  const {
    modelConfig,
    dataSets,
    setModelConfig,
    setPrevPromptConfig,
    setIntroduction,
    hasSetBlockStatus,
    showSelectDataSet,
    externalDataToolsConfig,
    isAdvancedMode,
    isAgent,
    setPromptMode,
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
  const promptVariablesObj = (() => {
    const obj: Record<string, boolean> = {}
    promptVariables.forEach((item) => {
      obj[item.key] = true
    })
    return obj
  })()

  const [newPromptVariables, setNewPromptVariables] = React.useState<PromptVariable[]>(promptVariables)
  const [newTemplates, setNewTemplates] = React.useState('')
  const [isShowConfirmAddVar, { setTrue: showConfirmAddVar, setFalse: hideConfirmAddVar }] = useBoolean(false)

  const handleChange = (newTemplates: string, keys: string[]) => {
    const newPromptVariables = keys.filter(key => !(key in promptVariablesObj) && !externalDataToolsConfig.find(item => item.variable === key)).map(key => getNewVar(key, ''))
    if (newPromptVariables.length > 0) {
      setNewPromptVariables(newPromptVariables)
      setNewTemplates(newTemplates)
      showConfirmAddVar()
      return
    }
    onChange?.(newTemplates, [])
  }

  const handleAutoAdd = (isAdd: boolean) => {
    return () => {
      onChange?.(newTemplates, isAdd ? newPromptVariables : [])
      hideConfirmAddVar()
    }
  }

  const [showAutomatic, { setTrue: showAutomaticTrue, setFalse: showAutomaticFalse }] = useBoolean(false)
  const handleAutomaticRes = (res: AutomaticRes) => {
    const newModelConfig = produce(modelConfig, (draft) => {
      draft.configs.prompt_template = res.prompt
      draft.configs.prompt_variables = res.variables.map(key => ({ key, name: key, type: 'string', required: true }))
    })
    setModelConfig(newModelConfig)
    setPrevPromptConfig(modelConfig.configs)
    if (mode === AppType.chat)
      setIntroduction(res.opening_statement)
    showAutomaticFalse()
    eventEmitter?.emit({
      type: PROMPT_EDITOR_UPDATE_VALUE_BY_EVENT_EMITTER,
      payload: res.prompt,
    } as any)
  }
  const minHeight = 228
  const [editorHeight, setEditorHeight] = useState(minHeight)

  return (
    <div className={cn(!readonly ? `${s.gradientBorder}` : 'bg-gray-50', ' relative shadow-md')}>
      <div className='rounded-xl bg-[#EEF4FF]'>
        <div className="flex justify-between items-center h-11 px-3">
          <div className="flex items-center space-x-1">
            <svg width="14" height="13" viewBox="0 0 14 13" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path fillRule="evenodd" clipRule="evenodd" d="M3.00001 0.100098C3.21218 0.100098 3.41566 0.184383 3.56569 0.334412C3.71572 0.484441 3.80001 0.687924 3.80001 0.900098V1.7001H4.60001C4.81218 1.7001 5.01566 1.78438 5.16569 1.93441C5.31572 2.08444 5.40001 2.28792 5.40001 2.5001C5.40001 2.71227 5.31572 2.91575 5.16569 3.06578C5.01566 3.21581 4.81218 3.3001 4.60001 3.3001H3.80001V4.1001C3.80001 4.31227 3.71572 4.51575 3.56569 4.66578C3.41566 4.81581 3.21218 4.9001 3.00001 4.9001C2.78783 4.9001 2.58435 4.81581 2.43432 4.66578C2.28429 4.51575 2.20001 4.31227 2.20001 4.1001V3.3001H1.40001C1.18783 3.3001 0.98435 3.21581 0.834321 3.06578C0.684292 2.91575 0.600006 2.71227 0.600006 2.5001C0.600006 2.28792 0.684292 2.08444 0.834321 1.93441C0.98435 1.78438 1.18783 1.7001 1.40001 1.7001H2.20001V0.900098C2.20001 0.687924 2.28429 0.484441 2.43432 0.334412C2.58435 0.184383 2.78783 0.100098 3.00001 0.100098ZM3.00001 8.1001C3.21218 8.1001 3.41566 8.18438 3.56569 8.33441C3.71572 8.48444 3.80001 8.68792 3.80001 8.9001V9.7001H4.60001C4.81218 9.7001 5.01566 9.78438 5.16569 9.93441C5.31572 10.0844 5.40001 10.2879 5.40001 10.5001C5.40001 10.7123 5.31572 10.9158 5.16569 11.0658C5.01566 11.2158 4.81218 11.3001 4.60001 11.3001H3.80001V12.1001C3.80001 12.3123 3.71572 12.5158 3.56569 12.6658C3.41566 12.8158 3.21218 12.9001 3.00001 12.9001C2.78783 12.9001 2.58435 12.8158 2.43432 12.6658C2.28429 12.5158 2.20001 12.3123 2.20001 12.1001V11.3001H1.40001C1.18783 11.3001 0.98435 11.2158 0.834321 11.0658C0.684292 10.9158 0.600006 10.7123 0.600006 10.5001C0.600006 10.2879 0.684292 10.0844 0.834321 9.93441C0.98435 9.78438 1.18783 9.7001 1.40001 9.7001H2.20001V8.9001C2.20001 8.68792 2.28429 8.48444 2.43432 8.33441C2.58435 8.18438 2.78783 8.1001 3.00001 8.1001ZM8.60001 0.100098C8.77656 0.100041 8.94817 0.158388 9.0881 0.266047C9.22802 0.373706 9.32841 0.52463 9.37361 0.695298L10.3168 4.2601L13 5.8073C13.1216 5.87751 13.2226 5.9785 13.2928 6.10011C13.363 6.22173 13.4 6.35967 13.4 6.5001C13.4 6.64052 13.363 6.77847 13.2928 6.90008C13.2226 7.02169 13.1216 7.12268 13 7.1929L10.3168 8.7409L9.37281 12.3049C9.32753 12.4754 9.22716 12.6262 9.08732 12.7337C8.94748 12.8413 8.77602 12.8996 8.59961 12.8996C8.42319 12.8996 8.25173 12.8413 8.11189 12.7337C7.97205 12.6262 7.87169 12.4754 7.82641 12.3049L6.88321 8.7401L4.20001 7.1929C4.0784 7.12268 3.97742 7.02169 3.90721 6.90008C3.837 6.77847 3.80004 6.64052 3.80004 6.5001C3.80004 6.35967 3.837 6.22173 3.90721 6.10011C3.97742 5.9785 4.0784 5.87751 4.20001 5.8073L6.88321 4.2593L7.82721 0.695298C7.87237 0.524762 7.97263 0.373937 8.1124 0.266291C8.25216 0.158646 8.42359 0.100217 8.60001 0.100098Z" fill="#5850EC" />
            </svg>
            <div className='h2'>{mode === AppType.chat ? t('appDebug.chatSubTitle') : t('appDebug.completionSubTitle')}</div>
            {!readonly && (
              <Tooltip
                htmlContent={<div className='w-[180px]'>
                  {t('appDebug.promptTip')}
                </div>}
                selector='config-prompt-tooltip'>
                <HelpCircle className='w-[14px] h-[14px] text-indigo-400' />
              </Tooltip>
            )}
          </div>
          <div className='flex items-center'>
            <AutomaticBtn onClick={showAutomaticTrue} />
            {!isAgent && !isAdvancedMode && (
              <>
                <div className='mx-1 w-px h-3.5 bg-black/5'></div>
                <div
                  className='flex items-center px-2 space-x-1 text-xs font-semibold text-[#444CE7] cursor-pointer'
                  onClick={() => setPromptMode(PromptMode.advanced)}
                >
                  <div>{t('appDebug.promptMode.advanced')}</div>
                  <ArrowNarrowRight className='w-3 h-3'></ArrowNarrowRight>
                </div>
              </>
            )}
          </div>
        </div>
        <PromptEditorHeightResizeWrap
          className='px-4 py-2 min-h-[228px] bg-white rounded-xl text-sm text-gray-700'
          height={editorHeight}
          minHeight={minHeight}
          onHeightChange={setEditorHeight}
        >
          <PromptEditor
            className='min-h-[210px]'
            value={promptTemplate}
            contextBlock={{
              show: false,
              selectable: !hasSetBlockStatus.context,
              datasets: dataSets.map(item => ({
                id: item.id,
                name: item.name,
                type: item.data_source_type,
              })),
              onAddContext: showSelectDataSet,
            }}
            variableBlock={{
              variables: modelConfig.configs.prompt_variables.filter(item => item.type !== 'api').map(item => ({
                name: item.name,
                value: item.key,
              })),
              externalTools: modelConfig.configs.prompt_variables.filter(item => item.type === 'api').map(item => ({
                name: item.name,
                variableName: item.key,
                icon: item.icon,
                icon_background: item.icon_background,
              })),
              onAddExternalTool: handleOpenExternalDataToolModal,
            }}
            historyBlock={{
              show: false,
              selectable: false,
              history: {
                user: '',
                assistant: '',
              },
              onEditRole: () => { },
            }}
            queryBlock={{
              show: false,
              selectable: !hasSetBlockStatus.query,
            }}
            onChange={(value) => {
              handleChange?.(value, [])
            }}
            onBlur={() => {
              handleChange(promptTemplate, getVars(promptTemplate))
            }}
          />
        </PromptEditorHeightResizeWrap>
      </div>

      {isShowConfirmAddVar && (
        <ConfirmAddVar
          varNameArr={newPromptVariables.map(v => v.name)}
          onConfrim={handleAutoAdd(true)}
          onCancel={handleAutoAdd(false)}
          onHide={hideConfirmAddVar}
        />
      )}

      {showAutomatic && (
        <GetAutomaticResModal
          mode={mode as AppType}
          isShow={showAutomatic}
          onClose={showAutomaticFalse}
          onFinished={handleAutomaticRes}
        />
      )}
    </div>
  )
}

export default React.memo(Prompt)
