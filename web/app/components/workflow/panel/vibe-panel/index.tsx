'use client'

import type { FC } from 'react'
import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { CompletionParams, Model } from '@/types/app'
import { RiCheckLine, RiRefreshLine } from '@remixicon/react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ResPlaceholder from '@/app/components/app/configuration/config/automatic/res-placeholder'
import Button from '@/app/components/base/button'
import { Generator } from '@/app/components/base/icons/src/vender/other'
import Loading from '@/app/components/base/loading'
import Flowchart from '@/app/components/base/mermaid'
import Modal from '@/app/components/base/modal'
import Textarea from '@/app/components/base/textarea'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import { ModelModeType } from '@/types/app'
import { VIBE_ACCEPT_EVENT, VIBE_COMMAND_EVENT, VIBE_REGENERATE_EVENT } from '../../constants'
import { useStore } from '../../store'

const VibePanel: FC = () => {
  const { t } = useTranslation()
  const showVibePanel = useStore(s => s.showVibePanel)
  const setShowVibePanel = useStore(s => s.setShowVibePanel)
  const vibePanelMermaidCode = useStore(s => s.vibePanelMermaidCode)
  const setVibePanelMermaidCode = useStore(s => s.setVibePanelMermaidCode)
  const isVibeGenerating = useStore(s => s.isVibeGenerating)
  const setIsVibeGenerating = useStore(s => s.setIsVibeGenerating)
  const vibePanelInstruction = useStore(s => s.vibePanelInstruction)
  const setVibePanelInstruction = useStore(s => s.setVibePanelInstruction)

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

  const handleClose = useCallback(() => {
    setShowVibePanel(false)
    setVibePanelMermaidCode('')
    setIsVibeGenerating(false)
  }, [setShowVibePanel, setVibePanelMermaidCode, setIsVibeGenerating])

  const handleGenerate = useCallback(() => {
    const event = new CustomEvent(VIBE_COMMAND_EVENT, {
      detail: { dsl: vibePanelInstruction },
    })
    document.dispatchEvent(event)
  }, [vibePanelInstruction])

  const handleAccept = useCallback(() => {
    if (vibePanelMermaidCode) {
      const event = new CustomEvent(VIBE_ACCEPT_EVENT, {
        detail: { dsl: vibePanelMermaidCode },
      })
      document.dispatchEvent(event)
      handleClose()
    }
  }, [vibePanelMermaidCode, handleClose])

  const handleRegenerate = useCallback(() => {
    setIsVibeGenerating(true)
    const event = new CustomEvent(VIBE_REGENERATE_EVENT)
    document.dispatchEvent(event)
  }, [setIsVibeGenerating])

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
              onChange={e => setVibePanelInstruction(e.target.value)}
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
              <span className="text-xs font-semibold">{t('appDebug.generate.generate')}</span>
            </Button>
          </div>
        </div>

        {!isVibeGenerating && vibePanelMermaidCode && (
          <div className="h-full w-0 grow bg-background-default-subtle p-6 pb-0">
            <div className="flex h-full flex-col">
              <div className="mb-3 flex shrink-0 items-center justify-between">
                <div className="shrink-0 text-base font-semibold leading-[160%] text-text-secondary">{t('workflow.vibe.panelTitle')}</div>
                <div className="flex items-center space-x-2">
                  <Button
                    variant="secondary"
                    size="medium"
                    onClick={handleRegenerate}
                  >
                    <RiRefreshLine className="mr-1 h-4 w-4" />
                    {t('workflow.vibe.regenerate')}
                  </Button>
                  <Button
                    variant="primary"
                    size="medium"
                    onClick={handleAccept}
                  >
                    <RiCheckLine className="mr-1 h-4 w-4" />
                    {t('workflow.vibe.accept')}
                  </Button>
                </div>
              </div>
              <div className="flex grow flex-col overflow-y-auto pb-6">
                <div className="grow">
                  <Flowchart
                    PrimitiveCode={vibePanelMermaidCode}
                    theme="light"
                  />
                </div>
              </div>
            </div>
          </div>
        )}
        {isVibeGenerating && renderLoading}
        {!isVibeGenerating && !vibePanelMermaidCode && <ResPlaceholder />}
      </div>
    </Modal>
  )
}

export default VibePanel
