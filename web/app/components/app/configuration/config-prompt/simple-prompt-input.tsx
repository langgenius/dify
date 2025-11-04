'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
import { produce } from 'immer'
import { useContext } from 'use-context-selector'
import ConfirmAddVar from './confirm-add-var'
import PromptEditorHeightResizeWrap from './prompt-editor-height-resize-wrap'
import cn from '@/utils/classnames'
import type { PromptVariable } from '@/models/debug'
import Tooltip from '@/app/components/base/tooltip'
import { AppType } from '@/types/app'
import { getNewVar, getVars } from '@/utils/var'
import AutomaticBtn from '@/app/components/app/configuration/config/automatic/automatic-btn'
import type { GenRes } from '@/service/debug'
import GetAutomaticResModal from '@/app/components/app/configuration/config/automatic/get-automatic-res'
import PromptEditor from '@/app/components/base/prompt-editor'
import ConfigContext from '@/context/debug-configuration'
import { useModalContext } from '@/context/modal-context'
import type { ExternalDataTool } from '@/models/common'
import { useToastContext } from '@/app/components/base/toast'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { ADD_EXTERNAL_DATA_TOOL } from '@/app/components/app/configuration/config-var'
import { INSERT_VARIABLE_VALUE_BLOCK_COMMAND } from '@/app/components/base/prompt-editor/plugins/variable-block'
import { PROMPT_EDITOR_UPDATE_VALUE_BY_EVENT_EMITTER } from '@/app/components/base/prompt-editor/plugins/update-block'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { useFeaturesStore } from '@/app/components/base/features/hooks'
import { noop } from 'lodash-es'

export type ISimplePromptInput = {
  mode: AppType
  promptTemplate: string
  promptVariables: PromptVariable[]
  readonly?: boolean
  onChange?: (prompt: string, promptVariables: PromptVariable[]) => void
  noTitle?: boolean
  gradientBorder?: boolean
  editorHeight?: number
  noResize?: boolean
}

const Prompt: FC<ISimplePromptInput> = ({
  mode,
  promptTemplate,
  promptVariables,
  readonly = false,
  onChange,
  noTitle,
  editorHeight: initEditorHeight,
  noResize,
}) => {
  const { t } = useTranslation()
  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile
  const featuresStore = useFeaturesStore()
  const {
    features,
    setFeatures,
  } = featuresStore!.getState()

  const { eventEmitter } = useEventEmitterContextContext()
  const {
    appId,
    modelConfig,
    dataSets,
    setModelConfig,
    setPrevPromptConfig,
    setIntroduction,
    hasSetBlockStatus,
    showSelectDataSet,
    externalDataToolsConfig,
  } = useContext(ConfigContext)
  const { notify } = useToastContext()
  const { setShowExternalDataToolModal } = useModalContext()
  const handleOpenExternalDataToolModal = () => {
    setShowExternalDataToolModal({
      payload: {},
      onSaveCallback: (newExternalDataTool?: ExternalDataTool) => {
        if (!newExternalDataTool)
          return
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

  const [newPromptVariables, setNewPromptVariables] = React.useState<PromptVariable[]>(promptVariables)
  const [newTemplates, setNewTemplates] = React.useState('')
  const [isShowConfirmAddVar, { setTrue: showConfirmAddVar, setFalse: hideConfirmAddVar }] = useBoolean(false)

  const handleChange = (newTemplates: string, keys: string[]) => {
    // Filter out keys that are not properly defined (either not exist or exist but without valid name)
    const newPromptVariables = keys.filter((key) => {
      // Check if key exists in external data tools
      if (externalDataToolsConfig.find((item: ExternalDataTool) => item.variable === key))
        return false

      // Check if key exists in prompt variables
      const existingVar = promptVariables.find((item: PromptVariable) => item.key === key)
      if (!existingVar) {
        // Variable doesn't exist at all
        return true
      }

      // Variable exists but check if it has valid name and key
      return !existingVar.name || !existingVar.name.trim() || !existingVar.key || !existingVar.key.trim()

      return false
    }).map(key => getNewVar(key, ''))

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
  const handleAutomaticRes = (res: GenRes) => {
    // put eventEmitter in first place to prevent overwrite the configs.prompt_variables.But another problem is that prompt won't hight the prompt_variables.
    eventEmitter?.emit({
      type: PROMPT_EDITOR_UPDATE_VALUE_BY_EVENT_EMITTER,
      payload: res.modified,
    } as any)
    const newModelConfig = produce(modelConfig, (draft) => {
      draft.configs.prompt_template = res.modified
      draft.configs.prompt_variables = (res.variables || []).map(key => ({ key, name: key, type: 'string', required: true }))
    })
    setModelConfig(newModelConfig)
    setPrevPromptConfig(modelConfig.configs)

    if (mode !== AppType.completion) {
      setIntroduction(res.opening_statement || '')
      const newFeatures = produce(features, (draft) => {
        draft.opening = {
          ...draft.opening,
          enabled: !!res.opening_statement,
          opening_statement: res.opening_statement,
        }
      })
      setFeatures(newFeatures)
    }
    showAutomaticFalse()
  }
  const minHeight = initEditorHeight || 228
  const [editorHeight, setEditorHeight] = useState(minHeight)

  return (
    <div className={cn('relative rounded-xl bg-gradient-to-r from-components-input-border-active-prompt-1 to-components-input-border-active-prompt-2 p-0.5 shadow-xs')}>
      <div className='rounded-xl bg-background-section-burn'>
        {!noTitle && (
          <div className="flex h-11 items-center justify-between pl-3 pr-2.5">
            <div className="flex items-center space-x-1">
              <div className='h2 system-sm-semibold-uppercase text-text-secondary'>{mode !== AppType.completion ? t('appDebug.chatSubTitle') : t('appDebug.completionSubTitle')}</div>
              {!readonly && (
                <Tooltip
                  popupContent={
                    <div className='w-[180px]'>
                      {t('appDebug.promptTip')}
                    </div>
                  }
                />
              )}
            </div>
            <div className='flex items-center'>
              {!readonly && !isMobile && (
                <AutomaticBtn onClick={showAutomaticTrue} />
              )}
            </div>
          </div>
        )}

        <PromptEditorHeightResizeWrap
          className='min-h-[228px] rounded-t-xl bg-background-default px-4 pt-2 text-sm text-text-secondary'
          height={editorHeight}
          minHeight={minHeight}
          onHeightChange={setEditorHeight}
          hideResize={noResize}
          footer={(
            <div className='flex rounded-b-xl bg-background-default pb-2 pl-4'>
              <div className="h-[18px] rounded-md bg-components-badge-bg-gray-soft px-1 text-xs leading-[18px] text-text-tertiary">{promptTemplate.length}</div>
            </div>
          )}
        >
          <PromptEditor
            className='min-h-[210px]'
            compact
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
              show: true,
              variables: modelConfig.configs.prompt_variables.filter((item: PromptVariable) => item.type !== 'api' && item.key && item.key.trim() && item.name && item.name.trim()).map((item: PromptVariable) => ({
                name: item.name,
                value: item.key,
              })),
            }}
            externalToolBlock={{
              show: true,
              externalTools: modelConfig.configs.prompt_variables.filter((item: PromptVariable) => item.type === 'api').map((item: PromptVariable) => ({
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
              onEditRole: noop,
            }}
            queryBlock={{
              show: false,
              selectable: !hasSetBlockStatus.query,
            }}
            onChange={(value) => {
              if (handleChange)
                handleChange(value, [])
            }}
            onBlur={() => {
              handleChange(promptTemplate, getVars(promptTemplate))
            }}
            editable={!readonly}
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

      {showAutomatic && (
        <GetAutomaticResModal
          flowId={appId}
          mode={mode as AppType}
          isShow={showAutomatic}
          onClose={showAutomaticFalse}
          onFinished={handleAutomaticRes}
          currentPrompt={promptTemplate}
          isBasicMode
        />
      )}
    </div>
  )
}

export default React.memo(Prompt)
