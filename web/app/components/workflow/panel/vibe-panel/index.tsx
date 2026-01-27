'use client'

import type { FC } from 'react'
import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { CompletionParams, Model } from '@/types/app'
import { RiClipboardLine } from '@remixicon/react'
import copy from 'copy-to-clipboard'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import ResPlaceholder from '@/app/components/app/configuration/config/automatic/res-placeholder'
import VersionSelector from '@/app/components/app/configuration/config/automatic/version-selector'
import Button from '@/app/components/base/button'
import { Generator } from '@/app/components/base/icons/src/vender/other'
import Loading from '@/app/components/base/loading'
import Modal from '@/app/components/base/modal'
import Textarea from '@/app/components/base/textarea'
import Toast from '@/app/components/base/toast'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import { ModelModeType } from '@/types/app'
import { VIBE_APPLY_EVENT, VIBE_COMMAND_EVENT } from '../../constants'
import { useStore, useWorkflowStore } from '../../store'
import WorkflowPreview from '../../workflow-preview'

const CompletionParamsSchema = z.object({
  max_tokens: z.number(),
  temperature: z.number(),
  top_p: z.number(),
  echo: z.boolean(),
  stop: z.array(z.string()),
  presence_penalty: z.number(),
  frequency_penalty: z.number(),
})

const ModelSchema = z.object({
  provider: z.string(),
  name: z.string(),
  mode: z.nativeEnum(ModelModeType),
  completion_params: CompletionParamsSchema,
})

const VibePanel: FC = () => {
  const { t } = useTranslation()
  const workflowStore = useWorkflowStore()
  const showVibePanel = useStore(s => s.showVibePanel)
  const setShowVibePanel = useStore(s => s.setShowVibePanel)
  const isVibeGenerating = useStore(s => s.isVibeGenerating)
  const setIsVibeGenerating = useStore(s => s.setIsVibeGenerating)
  const vibePanelInstruction = useStore(s => s.vibePanelInstruction)
  const vibePanelMermaidCode = useStore(s => s.vibePanelMermaidCode)
  const setVibePanelMermaidCode = useStore(s => s.setVibePanelMermaidCode)
  const currentFlowGraph = useStore(s => s.currentVibeFlow)
  const versions = useStore(s => s.vibeFlowVersions)
  const currentVersionIndex = useStore(s => s.vibeFlowCurrentIndex)

  const vibePanelPreviewNodes = currentFlowGraph?.nodes || []
  const vibePanelPreviewEdges = currentFlowGraph?.edges || []

  const setVibePanelInstruction = useStore(s => s.setVibePanelInstruction)
  const vibePanelIntent = useStore(s => s.vibePanelIntent)
  const setVibePanelIntent = useStore(s => s.setVibePanelIntent)
  const vibePanelMessage = useStore(s => s.vibePanelMessage)
  const setVibePanelMessage = useStore(s => s.setVibePanelMessage)
  const vibePanelSuggestions = useStore(s => s.vibePanelSuggestions)
  const setVibePanelSuggestions = useStore(s => s.setVibePanelSuggestions)

  const { defaultModel } = useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.textGeneration)

  // Track user's explicit model selection (from localStorage)
  const [userModel, setUserModel] = useState<Model | null>(() => {
    try {
      const stored = localStorage.getItem('auto-gen-model')
      if (stored) {
        const parsed = JSON.parse(stored)
        const result = ModelSchema.safeParse(parsed)
        if (result.success)
          return result.data

        // If validation fails, clear the invalid data
        localStorage.removeItem('auto-gen-model')
      }
    }
    catch {
      // ignore parse errors
    }
    return null
  })

  // Derive the actual model from user selection or default
  const model: Model = useMemo(() => {
    if (userModel)
      return userModel
    if (defaultModel) {
      return {
        name: defaultModel.model,
        provider: defaultModel.provider.provider,
        mode: ModelModeType.chat,
        completion_params: {} as CompletionParams,
      }
    }
    return {
      name: '',
      provider: '',
      mode: ModelModeType.chat,
      completion_params: {} as CompletionParams,
    }
  }, [userModel, defaultModel])

  const setModel = useCallback((newModel: Model) => {
    setUserModel(newModel)
    localStorage.setItem('auto-gen-model', JSON.stringify(newModel))
  }, [])

  const handleModelChange = useCallback((newValue: { modelId: string, provider: string, mode?: string, features?: string[] }) => {
    setModel({
      ...model,
      provider: newValue.provider,
      name: newValue.modelId,
      mode: newValue.mode as ModelModeType,
    })
  }, [model, setModel])

  const handleCompletionParamsChange = useCallback((newParams: FormValue) => {
    setModel({
      ...model,
      completion_params: newParams as CompletionParams,
    })
  }, [model, setModel])

  const handleInstructionChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    workflowStore.setState(state => ({
      ...state,
      vibePanelInstruction: e.target.value,
    }))
  }, [workflowStore])

  const handleClose = useCallback(() => {
    setShowVibePanel(false)
    setVibePanelMermaidCode('')
    setIsVibeGenerating(false)
    setVibePanelIntent('')
    setVibePanelMessage('')
    setVibePanelSuggestions([])
  }, [setShowVibePanel, setVibePanelMermaidCode, setIsVibeGenerating, setVibePanelIntent, setVibePanelMessage, setVibePanelSuggestions])

  const handleGenerate = useCallback(() => {
    const event = new CustomEvent(VIBE_COMMAND_EVENT, {
      detail: { dsl: vibePanelInstruction },
    })
    document.dispatchEvent(event)
  }, [vibePanelInstruction])

  const handleAccept = useCallback(() => {
    const event = new CustomEvent(VIBE_APPLY_EVENT)
    document.dispatchEvent(event)
    handleClose()
  }, [handleClose])

  const handleCopyMermaid = useCallback(() => {
    copy(vibePanelMermaidCode)
    Toast.notify({ type: 'success', message: t('actionMsg.copySuccessfully', { ns: 'common' }) })
  }, [vibePanelMermaidCode, t])

  const handleSuggestionClick = useCallback((suggestion: string) => {
    setVibePanelInstruction(suggestion)
    // Trigger generation with the suggestion
    const event = new CustomEvent(VIBE_COMMAND_EVENT, {
      detail: { dsl: suggestion },
    })
    document.dispatchEvent(event)
  }, [setVibePanelInstruction])

  const handleVersionChange = useCallback((index: number) => {
    const { setVibeFlowCurrentIndex } = workflowStore.getState()
    setVibeFlowCurrentIndex(index)
  }, [workflowStore])

  // Button label - always use "Generate" (refinement mode removed)
  const generateButtonLabel = useMemo(() => {
    return t('generate.generate', { ns: 'appDebug' })
  }, [t])

  if (!showVibePanel)
    return null

  const renderLoading = (
    <div className="flex h-full w-full grow flex-col items-center justify-center space-y-3">
      <Loading />
      <div className="text-[13px] text-text-tertiary">{t('vibe.generatingFlowchart', { ns: 'workflow' })}</div>
    </div>
  )

  const renderOffTopic = (
    <div className="flex h-full w-0 grow flex-col items-center justify-center p-6">
      <div className="flex max-w-[400px] flex-col items-center text-center">
        <div className="text-sm font-medium text-text-secondary">
          {t('vibe.offTopicTitle', { ns: 'workflow' })}
        </div>
        <div className="mt-1 text-xs text-text-tertiary">
          {vibePanelMessage || t('vibe.offTopicDefault', { ns: 'workflow' })}
        </div>
        {vibePanelSuggestions.length > 0 && (
          <div className="mt-6 w-full">
            <div className="mb-2 text-xs text-text-quaternary">
              {t('vibe.trySuggestion', { ns: 'workflow' })}
            </div>
            <div className="flex flex-col gap-2">
              {vibePanelSuggestions.map(suggestion => (
                <button
                  key={suggestion}
                  onClick={() => handleSuggestionClick(suggestion)}
                  className="w-full cursor-pointer rounded-lg border border-divider-subtle bg-components-panel-bg px-3 py-2.5 text-left text-sm text-text-secondary transition-colors hover:border-divider-regular hover:bg-state-base-hover"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )

  return (
    <Modal
      isShow={showVibePanel}
      onClose={handleClose}
      className="min-w-[1140px] !p-0"
      clickOutsideNotClose
    >
      <div className="flex h-[680px] flex-wrap">
        <div className="h-full w-[300px] shrink-0 overflow-y-auto border-r border-divider-regular p-6">
          <div className="mb-5">
            <div className="text-lg font-bold leading-[28px] text-text-primary">{t('gotoAnything.actions.vibeTitle', { ns: 'app' })}</div>
            <div className="mt-1 text-[13px] font-normal text-text-tertiary">{t('gotoAnything.actions.vibeDesc', { ns: 'app' })}</div>
          </div>
          <div>
            <ModelParameterModal
              popupClassName="!w-[520px]"
              portalToFollowElemContentClassName="z-[1000]"
              isAdvancedMode={true}
              provider={model.provider}
              completionParams={model.completion_params}
              modelId={model.name}
              setModel={handleModelChange}
              onCompletionParamsChange={handleCompletionParamsChange}
              hideDebugWithMultipleModel
            />
          </div>
          <div className="mt-4">
            <div className="system-sm-semibold-uppercase mb-1.5 text-text-secondary">{t('generate.instruction', { ns: 'appDebug' })}</div>
            <Textarea
              className="min-h-[240px] resize-none rounded-[10px] px-4 pt-3"
              placeholder={t('vibe.missingInstruction', { ns: 'workflow' })}
              value={vibePanelInstruction}
              onChange={handleInstructionChange}
            />
          </div>

          <div className="mt-7 flex justify-end space-x-2">
            <Button onClick={handleClose}>{t('generate.dismiss', { ns: 'appDebug' })}</Button>
            <Button
              className="flex space-x-1"
              variant="primary"
              onClick={handleGenerate}
              disabled={isVibeGenerating}
            >
              <Generator className="h-4 w-4" />
              <span className="system-xs-semibold">{generateButtonLabel}</span>
            </Button>
          </div>
        </div>

        {isVibeGenerating && (
          <div className="h-full w-0 grow bg-background-default-subtle">
            {renderLoading}
          </div>
        )}
        {!isVibeGenerating && vibePanelIntent === 'off_topic' && renderOffTopic}
        {!isVibeGenerating && vibePanelIntent !== 'off_topic' && (vibePanelPreviewNodes.length > 0 || vibePanelMermaidCode) && (
          <div className="relative h-full w-0 grow bg-background-default-subtle p-6 pb-0">
            <div className="flex h-full flex-col">
              <div className="mb-3 flex shrink-0 items-center justify-between">
                <div className="flex shrink-0 flex-col">
                  <div className="system-xl-semibold text-text-secondary">{t('vibe.panelTitle', { ns: 'workflow' })}</div>
                  <VersionSelector
                    versionLen={versions.length}
                    value={currentVersionIndex}
                    onChange={handleVersionChange}
                    contentClassName="z-[1200]"
                  />
                </div>
                <div className="flex items-center space-x-2">
                  <Button
                    variant="secondary"
                    size="medium"
                    onClick={handleCopyMermaid}
                    className="px-2"
                  >
                    <RiClipboardLine className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="primary"
                    size="medium"
                    onClick={handleAccept}
                  >
                    {t('vibe.apply', { ns: 'workflow' })}
                  </Button>
                </div>
              </div>
              <div className="flex grow flex-col overflow-hidden pb-6">
                <WorkflowPreview
                  key={currentVersionIndex}
                  fitView
                  fitViewOptions={{ padding: 0.2 }}
                  nodes={vibePanelPreviewNodes}
                  edges={vibePanelPreviewEdges}
                  className="rounded-lg border border-divider-subtle"
                />
              </div>
            </div>
          </div>
        )}
        {!isVibeGenerating && vibePanelIntent !== 'off_topic' && vibePanelPreviewNodes.length === 0 && !vibePanelMermaidCode && <ResPlaceholder />}
      </div>
    </Modal>
  )
}

export default VibePanel
