'use client'

import type { MouseEventHandler } from 'react'
import type { DefaultModel } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { DSLAgentRunResponse } from '@/models/app'
import { useDebounceFn, useKeyPress } from 'ahooks'
import { noop } from 'es-toolkit/function'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { trackEvent } from '@/app/components/base/amplitude'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
// eslint-disable-next-line no-restricted-imports
import Modal from '@/app/components/base/modal'
import Textarea from '@/app/components/base/textarea'
import { toast } from '@/app/components/base/ui/toast'
import AppsFull from '@/app/components/billing/apps-full-in-dialog'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useModelListAndDefaultModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'
import { usePluginDependencies } from '@/app/components/workflow/plugin-dependency/hooks'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import { useAppContext } from '@/context/app-context'
import { useProviderContext } from '@/context/provider-context'
import { DSLImportMode, DSLImportStatus } from '@/models/app'
import { useRouter } from '@/next/navigation'
import { createDSLRun, getDSLRun, importDSL, importDSLConfirm } from '@/service/apps'
import { getRedirection } from '@/utils/app-redirection'
import { cn } from '@/utils/classnames'
import ShortcutsName from '../../workflow/shortcuts-name'

type CreateFromAIModalProps = {
  show: boolean
  onSuccess?: () => void
  onClose: () => void
}

const DslAgentStage = {
  PLAN: 'plan',
  SOURCE_EVIDENCE: 'source-evidence',
  RESOLVE_DEPENDENCIES: 'resolve-dependencies',
  GENERATE: 'generate',
  NORMALIZE: 'normalize',
  VALIDATE: 'validate',
  REPAIR: 'repair',
  IMPORT: 'import',
  DEPENDENCIES: 'dependencies',
} as const

type DslAgentStage = typeof DslAgentStage[keyof typeof DslAgentStage]

type DslAgentStageState = {
  active?: DslAgentStage
  completed: DslAgentStage[]
  failed?: DslAgentStage
  messages?: Partial<Record<DslAgentStage, string>>
}

const DSL_AGENT_STAGES = [
  DslAgentStage.PLAN,
  DslAgentStage.SOURCE_EVIDENCE,
  DslAgentStage.RESOLVE_DEPENDENCIES,
  DslAgentStage.GENERATE,
  DslAgentStage.NORMALIZE,
  DslAgentStage.VALIDATE,
  DslAgentStage.REPAIR,
  DslAgentStage.IMPORT,
  DslAgentStage.DEPENDENCIES,
]

const DSL_AGENT_RUN_POLL_INTERVAL = 1200

const DSL_AGENT_RUN_STAGE_MAP: Record<string, DslAgentStage> = {
  plan: DslAgentStage.PLAN,
  source_evidence: DslAgentStage.SOURCE_EVIDENCE,
  resolve_dependencies: DslAgentStage.RESOLVE_DEPENDENCIES,
  generate: DslAgentStage.GENERATE,
  normalize: DslAgentStage.NORMALIZE,
  validate: DslAgentStage.VALIDATE,
  repair: DslAgentStage.REPAIR,
}

const sleep = (timeout: number) => new Promise(resolve => setTimeout(resolve, timeout))

const CreateFromAIModal = ({ show, onSuccess, onClose }: CreateFromAIModalProps) => {
  const { push } = useRouter()
  const { t } = useTranslation()
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiAppName, setAiAppName] = useState('')
  const [selectedModel, setSelectedModel] = useState<DefaultModel>()
  const [generatedYaml, setGeneratedYaml] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [dslAgentStageState, setDslAgentStageState] = useState<DslAgentStageState>({ completed: [] })
  const [showErrorModal, setShowErrorModal] = useState(false)
  const [versions, setVersions] = useState<{ importedVersion: string, systemVersion: string }>()
  const [importId, setImportId] = useState<string>()
  const { modelList, defaultModel } = useModelListAndDefaultModel(ModelTypeEnum.textGeneration)
  const { handleCheckPluginDependencies } = usePluginDependencies()
  const { isCurrentWorkspaceEditor } = useAppContext()
  const { plan, enableBilling } = useProviderContext()
  const isAppsFull = enableBilling && plan.usage.buildApps >= plan.total.buildApps
  const isCreatingRef = useRef(false)

  const workspaceDefaultModel = useMemo<DefaultModel | undefined>(() => {
    if (defaultModel?.provider.provider && defaultModel?.model)
      return { provider: defaultModel.provider.provider, model: defaultModel.model }
    const firstProvider = modelList.find(provider => provider.models.length > 0)
    const firstModel = firstProvider?.models[0]
    if (firstProvider && firstModel)
      return { provider: firstProvider.provider, model: firstModel.model }
    return undefined
  }, [defaultModel, modelList])

  const activeModel = selectedModel || workspaceDefaultModel

  const resetDslAgentProgress = () => {
    setDslAgentStageState({ completed: [], messages: {} })
  }

  const startDslAgentStage = (stage: DslAgentStage, message?: string) => {
    setDslAgentStageState(prev => ({
      active: stage,
      completed: prev.completed.includes(stage)
        ? prev.completed.filter(item => item !== stage)
        : prev.completed,
      messages: {
        ...prev.messages,
        ...(message ? { [stage]: message } : {}),
      },
    }))
  }

  const completeDslAgentStage = (stage: DslAgentStage, message?: string) => {
    setDslAgentStageState(prev => ({
      active: prev.active === stage ? undefined : prev.active,
      completed: prev.completed.includes(stage) ? prev.completed : [...prev.completed, stage],
      failed: prev.failed,
      messages: {
        ...prev.messages,
        ...(message ? { [stage]: message } : {}),
      },
    }))
  }

  const failDslAgentStage = (stage?: DslAgentStage, message?: string) => {
    setDslAgentStageState(prev => ({
      ...prev,
      active: undefined,
      failed: stage || prev.failed || prev.active,
      messages: {
        ...prev.messages,
        ...(message && (stage || prev.failed || prev.active) ? { [stage || prev.failed || prev.active!]: message } : {}),
      },
    }))
  }

  const applyDslAgentRunProgress = (run: DSLAgentRunResponse) => {
    const completed: DslAgentStage[] = []
    let active: DslAgentStage | undefined
    let failed: DslAgentStage | undefined
    const messages: Partial<Record<DslAgentStage, string>> = {}

    for (const event of run.events || []) {
      const stage = DSL_AGENT_RUN_STAGE_MAP[event.stage]
      if (!stage)
        continue
      if (event.message)
        messages[stage] = event.message
      if (event.status === 'running')
        active = stage
      if (event.status === 'completed' || event.status === 'skipped') {
        if (!completed.includes(stage))
          completed.push(stage)
        if (active === stage)
          active = undefined
      }
      if (event.status === 'failed') {
        failed = stage
        active = undefined
      }
    }

    if (run.status === 'succeeded') {
      active = undefined
      for (const stage of [
        DslAgentStage.PLAN,
        DslAgentStage.SOURCE_EVIDENCE,
        DslAgentStage.RESOLVE_DEPENDENCIES,
        DslAgentStage.GENERATE,
        DslAgentStage.NORMALIZE,
        DslAgentStage.VALIDATE,
        DslAgentStage.REPAIR,
      ]) {
        if (!completed.includes(stage))
          completed.push(stage)
      }
    }
    if (run.status === 'failed')
      failed = failed || active || DslAgentStage.GENERATE
    if (failed && run.error)
      messages[failed] = run.error

    setDslAgentStageState({ active, completed, failed, messages })
  }

  const createAndPollDslAgentRun = async () => {
    startDslAgentStage(DslAgentStage.PLAN)
    let run = await createDSLRun({
      prompt: aiPrompt.trim(),
      app_name: aiAppName.trim() || undefined,
      provider: activeModel?.provider,
      model: activeModel?.model,
      input_variable: 'input',
      resolve_dependencies: true,
    })
    applyDslAgentRunProgress(run)

    while (run.status === 'queued' || run.status === 'running') {
      await sleep(DSL_AGENT_RUN_POLL_INTERVAL)
      run = await getDSLRun(run.id)
      applyDslAgentRunProgress(run)
    }

    if (run.status === 'failed' || !run.result)
      throw new Error(run.error || 'DSL agent run failed.')

    return run.result
  }

  const onCreate = async () => {
    if (!aiPrompt.trim() || !activeModel)
      return
    if (isCreatingRef.current)
      return
    isCreatingRef.current = true
    setIsCreating(true)
    setGeneratedYaml('')
    resetDslAgentProgress()

    try {
      const generated = await createAndPollDslAgentRun()
      setGeneratedYaml(generated.yaml_content)
      startDslAgentStage(DslAgentStage.IMPORT)
      const response = await importDSL({
        mode: DSLImportMode.YAML_CONTENT,
        yaml_content: generated.yaml_content,
        name: generated.name,
        description: generated.description,
      })
      completeDslAgentStage(DslAgentStage.IMPORT)

      const { id, status, app_id, app_mode, imported_dsl_version, current_dsl_version } = response
      if (status === DSLImportStatus.COMPLETED || status === DSLImportStatus.COMPLETED_WITH_WARNINGS) {
        trackEvent('create_app_with_ai', {
          app_mode,
          has_warnings: status === DSLImportStatus.COMPLETED_WITH_WARNINGS,
        })

        toast(t(status === DSLImportStatus.COMPLETED ? 'newApp.appCreated' : 'newApp.caution', { ns: 'app' }), {
          type: status === DSLImportStatus.COMPLETED ? 'success' : 'warning',
          description: status === DSLImportStatus.COMPLETED_WITH_WARNINGS
            ? t('newApp.appCreateDSLWarning', { ns: 'app' })
            : undefined,
        })
        localStorage.setItem(NEED_REFRESH_APP_LIST_KEY, '1')
        if (app_id) {
          startDslAgentStage(DslAgentStage.DEPENDENCIES)
          await handleCheckPluginDependencies(app_id)
          completeDslAgentStage(DslAgentStage.DEPENDENCIES)
        }
        if (onSuccess)
          onSuccess()
        if (onClose)
          onClose()
        getRedirection(isCurrentWorkspaceEditor, { id: app_id!, mode: app_mode }, push)
      }
      else if (status === DSLImportStatus.PENDING) {
        setVersions({
          importedVersion: imported_dsl_version ?? '',
          systemVersion: current_dsl_version ?? '',
        })
        setTimeout(() => {
          setShowErrorModal(true)
        }, 300)
        setImportId(id)
      }
      else {
        failDslAgentStage(DslAgentStage.IMPORT)
        toast.error(t('newApp.appCreateFailed', { ns: 'app' }))
      }
    }
    catch {
      failDslAgentStage()
      toast.error(t('newApp.appCreateFailed', { ns: 'app' }))
    }
    finally {
      isCreatingRef.current = false
      setIsCreating(false)
    }
  }

  const { run: handleCreateApp } = useDebounceFn(onCreate, { wait: 300 })

  useKeyPress(['meta.enter', 'ctrl.enter'], () => {
    if (show && !isAppsFull && aiPrompt.trim() && activeModel)
      handleCreateApp()
  })

  useKeyPress('esc', () => {
    if (show && !showErrorModal)
      onClose()
  })

  const onDSLConfirm: MouseEventHandler = async () => {
    try {
      if (!importId)
        return
      const response = await importDSLConfirm({
        import_id: importId,
      })

      const { status, app_id, app_mode } = response

      if (status === DSLImportStatus.COMPLETED) {
        if (onSuccess)
          onSuccess()
        if (onClose)
          onClose()

        toast.success(t('newApp.appCreated', { ns: 'app' }))
        if (app_id)
          await handleCheckPluginDependencies(app_id)
        localStorage.setItem(NEED_REFRESH_APP_LIST_KEY, '1')
        getRedirection(isCurrentWorkspaceEditor, { id: app_id!, mode: app_mode }, push)
      }
      else if (status === DSLImportStatus.FAILED) {
        toast.error(t('newApp.appCreateFailed', { ns: 'app' }))
      }
    }
    catch {
      toast.error(t('newApp.appCreateFailed', { ns: 'app' }))
    }
  }

  const buttonDisabled = isAppsFull || isCreating || !aiPrompt.trim() || !activeModel

  const shouldShowDslAgentProgress = isCreating
    || !!generatedYaml
    || dslAgentStageState.completed.length > 0
    || !!dslAgentStageState.failed

  return (
    <>
      <Modal
        className="w-[560px] rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-0 shadow-xl"
        isShow={show}
        onClose={noop}
      >
        <div className="flex items-center justify-between pt-6 pr-5 pb-3 pl-6 title-2xl-semi-bold text-text-primary">
          {t('newApp.startFromAI', { ns: 'app' })}
          <div
            className="flex h-8 w-8 cursor-pointer items-center"
            onClick={() => onClose()}
          >
            <span className="i-ri-close-line h-5 w-5 text-text-tertiary" />
          </div>
        </div>
        <div className="px-6 py-4">
          <div className="space-y-3">
            <div>
              <div className="mb-1 system-md-semibold text-text-secondary">{t('newApp.dslAgentPrompt', { ns: 'app' })}</div>
              <Textarea
                className="min-h-[116px]"
                placeholder={t('newApp.dslAgentPromptPlaceholder', { ns: 'app' }) || ''}
                value={aiPrompt}
                onChange={e => setAiPrompt(e.target.value)}
              />
            </div>
            <div>
              <div className="mb-1 system-md-semibold text-text-secondary">{t('newApp.dslAgentAppName', { ns: 'app' })}</div>
              <Input
                placeholder={t('newApp.appNamePlaceholder', { ns: 'app' }) || ''}
                value={aiAppName}
                onChange={e => setAiAppName(e.target.value)}
              />
            </div>
            <div>
              <div className="mb-1 system-md-semibold text-text-secondary">{t('newApp.dslAgentModel', { ns: 'app' })}</div>
              <ModelSelector
                defaultModel={activeModel}
                modelList={modelList}
                triggerClassName="h-10"
                popupClassName="z-50"
                onSelect={setSelectedModel}
              />
            </div>
            {!!generatedYaml && (
              <div className="max-h-[120px] overflow-auto rounded-lg bg-background-section-burn p-2 font-mono text-[11px] leading-4 text-text-tertiary">
                {generatedYaml}
              </div>
            )}
            {shouldShowDslAgentProgress && (
              <div className="rounded-lg border border-divider-subtle bg-background-section-burn p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="system-sm-semibold text-text-secondary">{t('newApp.dslAgentProgressTitle', { ns: 'app' })}</div>
                  {isCreating && (
                    <div className="system-xs-medium text-text-tertiary">{t('newApp.dslAgentWorking', { ns: 'app' })}</div>
                  )}
                </div>
                <div className="space-y-2">
                  {DSL_AGENT_STAGES.map((stage) => {
                    const isActive = dslAgentStageState.active === stage
                    const isCompleted = dslAgentStageState.completed.includes(stage)
                    const isFailed = dslAgentStageState.failed === stage
                    const stageMessage = dslAgentStageState.messages?.[stage]
                    return (
                      <div key={stage} className="flex items-start gap-2">
                        <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                          {isActive && <span className="i-ri-loader-2-line h-4 w-4 animate-spin text-text-accent" />}
                          {isCompleted && !isActive && <span className="i-ri-checkbox-circle-fill h-4 w-4 text-util-colors-green-green-600" />}
                          {isFailed && <span className="i-ri-error-warning-line h-4 w-4 text-util-colors-red-red-600" />}
                          {!isActive && !isCompleted && !isFailed && <div className="h-2 w-2 rounded-full bg-divider-regular" />}
                        </div>
                        <div>
                          <div className={cn(
                            'system-xs-medium',
                            isActive ? 'text-text-accent' : isFailed ? 'text-util-colors-red-red-600' : isCompleted ? 'text-text-secondary' : 'text-text-tertiary',
                          )}
                          >
                            {t(`newApp.dslAgentStage.${stage}`, { ns: 'app' })}
                          </div>
                          {(isActive || isFailed) && (
                            <div className="system-xs-regular text-text-tertiary">
                              {stageMessage || t(`newApp.dslAgentStage.${stage}.desc`, { ns: 'app' })}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
        {isAppsFull && (
          <div className="px-6">
            <AppsFull className="mt-0" loc="app-create-ai" />
          </div>
        )}
        <div className="flex justify-end px-6 py-5">
          <Button className="mr-2" onClick={onClose}>{t('newApp.Cancel', { ns: 'app' })}</Button>
          <Button
            disabled={buttonDisabled}
            variant="primary"
            onClick={handleCreateApp}
            className="gap-1"
          >
            {isCreating && <span className="i-ri-loader-2-line h-4 w-4 animate-spin" />}
            <span>{isCreating ? t('newApp.dslAgentWorking', { ns: 'app' }) : t('newApp.Create', { ns: 'app' })}</span>
            {!isCreating && <ShortcutsName keys={['ctrl', '↵']} bgColor="white" />}
          </Button>
        </div>
      </Modal>
      <Modal
        isShow={showErrorModal}
        onClose={() => setShowErrorModal(false)}
        className="w-[480px]"
      >
        <div className="flex flex-col items-start gap-2 self-stretch pb-4">
          <div className="title-2xl-semi-bold text-text-primary">{t('newApp.appCreateDSLErrorTitle', { ns: 'app' })}</div>
          <div className="flex grow flex-col system-md-regular text-text-secondary">
            <div>{t('newApp.appCreateDSLErrorPart1', { ns: 'app' })}</div>
            <div>{t('newApp.appCreateDSLErrorPart2', { ns: 'app' })}</div>
            <br />
            <div>
              {t('newApp.appCreateDSLErrorPart3', { ns: 'app' })}
              <span className="system-md-medium">{versions?.importedVersion}</span>
            </div>
            <div>
              {t('newApp.appCreateDSLErrorPart4', { ns: 'app' })}
              <span className="system-md-medium">{versions?.systemVersion}</span>
            </div>
          </div>
        </div>
        <div className="flex items-start justify-end gap-2 self-stretch pt-6">
          <Button variant="secondary" onClick={() => setShowErrorModal(false)}>{t('newApp.Cancel', { ns: 'app' })}</Button>
          <Button variant="primary" destructive onClick={onDSLConfirm}>{t('newApp.Confirm', { ns: 'app' })}</Button>
        </div>
      </Modal>
    </>
  )
}

export default CreateFromAIModal
