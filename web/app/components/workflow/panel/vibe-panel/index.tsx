'use client'

import type { FC } from 'react'
import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { CompletionParams, Model } from '@/types/app'
import { RiClipboardLine } from '@remixicon/react'
import copy from 'copy-to-clipboard'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
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

const VibePanel: FC = () => {
  const { t } = useTranslation()
  const workflowStore = useWorkflowStore()
  const showVibePanel = useStore(s => s.showVibePanel)
  const isVibeGenerating = useStore(s => s.isVibeGenerating)
  const vibePanelInstruction = useStore(s => s.vibePanelInstruction)
  const currentFlowGraph = useStore(s => s.currentVibeFlow)
  const versions = useStore(s => s.vibeFlowVersions)
  const currentVersionIndex = useStore(s => s.vibeFlowCurrentIndex)

  const vibePanelPreviewNodes = currentFlowGraph?.nodes || []
  const vibePanelPreviewEdges = currentFlowGraph?.edges || []

  const localModel = localStorage.getItem('auto-gen-model')
    ? JSON.parse(localStorage.getItem('auto-gen-model') as string) as Model
    : null
  const [model, setModel] = useState<Model>(localModel || {
    name: '',
    provider: '',
    mode: ModelModeType.chat,
    completion_params: {} as CompletionParams,
  })
  const { defaultModel } = useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.textGeneration)

  useEffect(() => {
    if (defaultModel) {
      const localModel = localStorage.getItem('auto-gen-model')
        ? JSON.parse(localStorage.getItem('auto-gen-model') || '')
        : null
      if (localModel) {
        setModel(localModel)
      }
      else {
        setModel(prev => ({
          ...prev,
          name: defaultModel.model,
          provider: defaultModel.provider.provider,
        }))
      }
    }
  }, [defaultModel])

  const handleModelChange = useCallback((newValue: { modelId: string, provider: string, mode?: string, features?: string[] }) => {
    const newModel = {
      ...model,
      provider: newValue.provider,
      name: newValue.modelId,
      mode: newValue.mode as ModelModeType,
    }
    setModel(newModel)
    localStorage.setItem('auto-gen-model', JSON.stringify(newModel))
  }, [model])

  const handleCompletionParamsChange = useCallback((newParams: FormValue) => {
    const newModel = {
      ...model,
      completion_params: newParams as CompletionParams,
    }
    setModel(newModel)
    localStorage.setItem('auto-gen-model', JSON.stringify(newModel))
  }, [model])

  const handleInstructionChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    workflowStore.setState(state => ({
      ...state,
      vibePanelInstruction: e.target.value,
    }))
  }, [workflowStore])

  const handleClose = useCallback(() => {
    workflowStore.setState(state => ({
      ...state,
      showVibePanel: false,
      vibePanelMermaidCode: '',
      isVibeGenerating: false,
    }))
  }, [workflowStore])

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
    const { vibePanelMermaidCode } = workflowStore.getState()
    copy(vibePanelMermaidCode)
    Toast.notify({ type: 'success', message: t('common.actionMsg.copySuccessfully') })
  }, [workflowStore, t])

  const handleVersionChange = useCallback((index: number) => {
    const { setVibeFlowCurrentIndex } = workflowStore.getState()
    setVibeFlowCurrentIndex(index)
  }, [workflowStore])

  if (!showVibePanel)
    return null

  const renderLoading = (
    <div className="flex h-full w-0 grow flex-col items-center justify-center space-y-3">
      <Loading />
      <div className="text-[13px] text-text-tertiary">{t('workflow.vibe.generatingFlowchart')}</div>
    </div>
  )

  return (
    <Modal
      isShow={showVibePanel}
      onClose={handleClose}
      className="min-w-[1140px] !p-0"
      wrapperClassName="z-[900]"
    >
      <div className="flex h-[680px] flex-wrap">
        <div className="h-full w-[570px] shrink-0 overflow-y-auto border-r border-divider-regular p-6">
          <div className="mb-5">
            <div className="text-lg font-bold leading-[28px] text-text-primary">{t('app.gotoAnything.actions.vibeTitle')}</div>
            <div className="mt-1 text-[13px] font-normal text-text-tertiary">{t('app.gotoAnything.actions.vibeDesc')}</div>
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
            <div className="system-sm-semibold-uppercase mb-1.5 text-text-secondary">{t('appDebug.generate.instruction')}</div>
            <Textarea
              className="min-h-[240px] resize-none rounded-[10px] px-4 pt-3"
              placeholder={t('workflow.vibe.missingInstruction')}
              value={vibePanelInstruction}
              onChange={handleInstructionChange}
            />
          </div>

          <div className="mt-7 flex justify-end space-x-2">
            <Button onClick={handleClose}>{t('appDebug.generate.dismiss')}</Button>
            <Button
              className="flex space-x-1"
              variant="primary"
              onClick={handleGenerate}
              disabled={isVibeGenerating}
            >
              <Generator className="h-4 w-4" />
              <span className="system-xs-semibold">{t('appDebug.generate.generate')}</span>
            </Button>
          </div>
        </div>

        {!isVibeGenerating && vibePanelPreviewNodes.length > 0 && (
          <div className="h-full w-0 grow bg-background-default-subtle p-6 pb-0">
            <div className="flex h-full flex-col">
              <div className="mb-3 flex shrink-0 items-center justify-between">
                <div className="flex shrink-0 flex-col">
                  <div className="system-xl-semibold text-text-secondary">{t('workflow.vibe.panelTitle')}</div>
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
                    {t('workflow.vibe.apply')}
                  </Button>
                </div>
              </div>
              <div className="flex grow flex-col overflow-hidden pb-6">
                <WorkflowPreview
                  key={currentVersionIndex}
                  nodes={vibePanelPreviewNodes}
                  edges={vibePanelPreviewEdges}
                  viewport={{ x: 0, y: 0, zoom: 1 }}
                  className="rounded-lg border border-divider-subtle"
                />
              </div>
            </div>
          </div>
        )}
        {isVibeGenerating && renderLoading}
        {!isVibeGenerating && vibePanelPreviewNodes.length === 0 && <ResPlaceholder />}
      </div>
    </Modal>
  )
}

export default VibePanel
