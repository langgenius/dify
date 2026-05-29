'use client'
import type { GeneratedGraph } from './types'
import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { CompletionParams, Model, ModelModeType } from '@/types/app'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { toast } from '@langgenius/dify-ui/toast'
import { RiClipboardLine } from '@remixicon/react'
import { useBoolean } from 'ahooks'
import copy from 'copy-to-clipboard'
import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import IdeaOutput from '@/app/components/app/configuration/config/automatic/idea-output'
import VersionSelector from '@/app/components/app/configuration/config/automatic/version-selector'
import { Generator } from '@/app/components/base/icons/src/vender/other'
import Loading from '@/app/components/base/loading'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import WorkflowPreview from '@/app/components/workflow/workflow-preview'
import { useAppContext } from '@/context/app-context'
import { useRouter } from '@/next/navigation'
import { generateWorkflow } from '@/service/debug'
import { getRedirectionPath } from '@/utils/app-redirection'
import { applyToCurrentApp, applyToNewApp } from './apply'
import { useWorkflowGeneratorStore } from './store'
import useGenGraph from './use-gen-graph'

const STORAGE_MODEL_KEY = 'workflow-gen-model'

const renderLoading = (label: string) => (
  <div className="flex h-full w-0 grow flex-col items-center justify-center space-y-3">
    <Loading />
    <div className="text-[13px] text-text-tertiary">{label}</div>
  </div>
)

const renderPlaceholder = (label: string) => (
  <div className="flex h-full w-0 grow flex-col items-center justify-center space-y-3 px-8">
    <Generator className="size-8 text-text-quaternary" />
    <div className="text-center text-[13px] leading-5 font-normal text-text-tertiary">
      {label}
    </div>
  </div>
)

const WorkflowGeneratorModal: React.FC = () => {
  const { t } = useTranslation('workflow')
  const router = useRouter()
  const { isCurrentWorkspaceEditor } = useAppContext()

  const isOpen = useWorkflowGeneratorStore(s => s.isOpen)
  const mode = useWorkflowGeneratorStore(s => s.mode)
  const currentAppId = useWorkflowGeneratorStore(s => s.currentAppId)
  const currentAppMode = useWorkflowGeneratorStore(s => s.currentAppMode)
  const closeGenerator = useWorkflowGeneratorStore(s => s.closeGenerator)

  const storedModel = (() => {
    if (typeof window === 'undefined')
      return null
    try {
      const raw = localStorage.getItem(STORAGE_MODEL_KEY)
      return raw ? JSON.parse(raw) as Model : null
    }
    catch {
      return null
    }
  })()

  const [model, setModel] = useState<Model>(storedModel || {
    name: '',
    provider: '',
    mode: 'chat' as unknown as ModelModeType.chat,
    completion_params: {} as CompletionParams,
  })

  const { defaultModel } = useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.textGeneration)

  // Hydrate model from defaultModel once it loads (async). We deliberately set state
  // from an effect here because defaultModel only resolves after the workspace's model
  // catalogue fetch completes.
  useEffect(() => {
    if (defaultModel && !model.name) {
      // eslint-disable-next-line react/set-state-in-effect
      setModel(prev => ({
        ...prev,
        name: defaultModel.model,
        provider: defaultModel.provider.provider,
      }))
    }
  }, [defaultModel, model.name])

  const handleModelChange = useCallback((newValue: { modelId: string, provider: string, mode?: string, features?: string[] }) => {
    const newModel: Model = {
      ...model,
      provider: newValue.provider,
      name: newValue.modelId,
      mode: newValue.mode as ModelModeType,
    }
    setModel(newModel)
    localStorage.setItem(STORAGE_MODEL_KEY, JSON.stringify(newModel))
  }, [model])

  const handleCompletionParamsChange = useCallback((newParams: FormValue) => {
    const newModel: Model = {
      ...model,
      completion_params: newParams as CompletionParams,
    }
    setModel(newModel)
    localStorage.setItem(STORAGE_MODEL_KEY, JSON.stringify(newModel))
  }, [model])

  const [instruction, setInstruction] = useState('')
  const [ideaOutput, setIdeaOutput] = useState('')

  const storageKey = `${mode}-${currentAppId ?? 'new'}`
  const { addVersion, current, currentVersionIndex, setCurrentVersionIndex, versions } = useGenGraph({
    storageKey,
  })

  const [isLoading, { setTrue: setLoadingTrue, setFalse: setLoadingFalse }] = useBoolean(false)
  const [isApplying, { setTrue: setApplyingTrue, setFalse: setApplyingFalse }] = useBoolean(false)

  // Confirmation dialog for "Apply to current draft"
  const [isShowConfirmOverwrite, { setTrue: showConfirmOverwrite, setFalse: hideConfirmOverwrite }] = useBoolean(false)

  // Note: the modal is mounted lazily by ``mount.tsx`` which unmounts it when
  // ``isOpen`` flips to false, so transient state (instruction / ideaOutput)
  // resets implicitly on the next open. No reset effect needed.

  const isValid = () => {
    const trimmed = instruction.trim()
    if (!trimmed) {
      toast.error(t('workflowGenerator.instructionRequired'))
      return false
    }
    return true
  }

  const onGenerate = async () => {
    if (!isValid() || isLoading)
      return
    setLoadingTrue()
    try {
      const res = await generateWorkflow({
        mode,
        instruction,
        ideal_output: ideaOutput,
        model_config: model,
      })
      if (res.error) {
        toast.error(res.error)
        return
      }
      addVersion(res)
    }
    catch (e: unknown) {
      const message = e instanceof Error ? e.message : ''
      toast.error(message || t('workflowGenerator.generateFailed'))
    }
    finally {
      setLoadingFalse()
    }
  }

  const canApplyToCurrent = !!currentAppId && currentAppMode === mode

  const handleCopy = useCallback(() => {
    if (!current?.graph)
      return
    copy(JSON.stringify(current.graph, null, 2))
    toast.success(t('workflowGenerator.copied'))
  }, [current, t])

  const handleApplyToNew = useCallback(async () => {
    if (!current?.graph || isApplying)
      return
    setApplyingTrue()
    try {
      const { appId, appMode } = await applyToNewApp({
        mode,
        graph: current.graph as GeneratedGraph,
        instruction,
      })
      toast.success(t('workflowGenerator.applied'))
      closeGenerator()
      router.push(getRedirectionPath(isCurrentWorkspaceEditor, { id: appId, mode: appMode }))
    }
    catch (e: unknown) {
      const message = e instanceof Error ? e.message : ''
      toast.error(message || t('workflowGenerator.applyFailed'))
    }
    finally {
      setApplyingFalse()
    }
  }, [current, instruction, mode, router, isCurrentWorkspaceEditor, closeGenerator, t, isApplying, setApplyingTrue, setApplyingFalse])

  const handleApplyToCurrentConfirmed = useCallback(async () => {
    if (!current?.graph || !currentAppId || isApplying)
      return
    hideConfirmOverwrite()
    setApplyingTrue()
    try {
      await applyToCurrentApp({ appId: currentAppId, graph: current.graph as GeneratedGraph })
      toast.success(t('workflowGenerator.applied'))
      closeGenerator()
      // Reload the workflow page so the canvas picks up the new draft.
      router.refresh()
    }
    catch (e: unknown) {
      const message = e instanceof Error ? e.message : ''
      toast.error(message || t('workflowGenerator.applyFailed'))
    }
    finally {
      setApplyingFalse()
    }
  }, [current, currentAppId, router, hideConfirmOverwrite, closeGenerator, t, isApplying, setApplyingTrue, setApplyingFalse])

  const modeLabel = mode === 'workflow' ? t('workflowGenerator.modes.workflow') : t('workflowGenerator.modes.chatflow')

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open)
          closeGenerator()
      }}
    >
      <DialogContent className="h-[min(680px,calc(100dvh-2rem))] max-h-none! w-[1140px] max-w-none! min-w-[1140px] overflow-hidden! border-none p-0! text-left align-middle">
        <div className="flex h-full min-h-0 flex-wrap">
          {/* Left pane: instructions + ideal output + model selector */}
          <div className="h-full w-[570px] shrink-0 overflow-y-auto border-r border-divider-regular p-6">
            <div className="mb-5">
              <div className="text-lg leading-[28px] font-bold text-text-primary">
                {t('workflowGenerator.title', { mode: modeLabel })}
              </div>
              <div className="mt-1 text-[13px] font-normal text-text-tertiary">
                {t('workflowGenerator.description')}
              </div>
            </div>

            <div>
              <ModelParameterModal
                popupClassName="w-[520px]!"
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
              <div className="mb-1.5 system-sm-semibold-uppercase text-text-secondary">
                {t('workflowGenerator.instruction')}
              </div>
              <Textarea
                className="h-[160px]"
                placeholder={t('workflowGenerator.instructionPlaceholder')}
                value={instruction}
                onValueChange={setInstruction}
              />

              <IdeaOutput
                value={ideaOutput}
                onChange={setIdeaOutput}
              />

              <div className="mt-7 flex justify-end space-x-2">
                <Button onClick={closeGenerator}>
                  {t('workflowGenerator.dismiss')}
                </Button>
                <Button
                  className="flex space-x-1"
                  variant="primary"
                  onClick={onGenerate}
                  disabled={isLoading}
                >
                  <Generator className="size-4" />
                  <span className="text-xs font-semibold">{t('workflowGenerator.generate')}</span>
                </Button>
              </div>
            </div>
          </div>

          {/* Right pane: preview + version selector + apply */}
          {(!isLoading && current?.graph?.nodes?.length)
            ? (
                <div className="flex h-full w-0 grow flex-col bg-background-default-subtle p-6">
                  <div className="mb-3 flex items-center justify-between">
                    <VersionSelector
                      versionLen={versions?.length || 0}
                      value={currentVersionIndex || 0}
                      onChange={setCurrentVersionIndex}
                    />
                    <div className="flex items-center space-x-2">
                      <Button size="small" variant="ghost" onClick={handleCopy}>
                        <RiClipboardLine className="size-4" />
                      </Button>
                      {canApplyToCurrent && (
                        <Button size="small" onClick={showConfirmOverwrite} disabled={isApplying}>
                          {t('workflowGenerator.applyToCurrent')}
                        </Button>
                      )}
                      <Button size="small" variant="primary" onClick={handleApplyToNew} disabled={isApplying}>
                        {t('workflowGenerator.applyToNew')}
                      </Button>
                    </div>
                  </div>
                  <div className="relative w-full grow overflow-hidden rounded-2xl border border-divider-subtle bg-background-default">
                    <WorkflowPreview
                      nodes={current.graph.nodes}
                      edges={current.graph.edges}
                      viewport={current.graph.viewport}
                    />
                  </div>
                  {current.message && (
                    <div className="mt-2 system-xs-regular text-text-tertiary">
                      {current.message}
                    </div>
                  )}
                </div>
              )
            : null}

          {isLoading && renderLoading(t('workflowGenerator.loading'))}

          {!isLoading && !current?.graph?.nodes?.length && renderPlaceholder(t('workflowGenerator.placeholder'))}
        </div>

        <AlertDialog open={isShowConfirmOverwrite} onOpenChange={open => !open && hideConfirmOverwrite()}>
          <AlertDialogContent>
            <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
              <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
                {t('workflowGenerator.overwriteTitle')}
              </AlertDialogTitle>
              <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
                {t('workflowGenerator.overwriteMessage')}
              </AlertDialogDescription>
            </div>
            <AlertDialogActions>
              <AlertDialogCancelButton>{t('operation.cancel', { ns: 'common' })}</AlertDialogCancelButton>
              <AlertDialogConfirmButton onClick={handleApplyToCurrentConfirmed}>
                {t('operation.confirm', { ns: 'common' })}
              </AlertDialogConfirmButton>
            </AlertDialogActions>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  )
}

export default React.memo(WorkflowGeneratorModal)
