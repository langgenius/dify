'use client'

import type { MouseEventHandler } from 'react'
import type { DSLAgentRunResponse } from '@/models/app'
import { useDebounceFn, useKeyPress } from 'ahooks'
import { noop } from 'es-toolkit/function'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { trackEvent } from '@/app/components/base/amplitude'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Modal from '@/app/components/base/modal'
import Textarea from '@/app/components/base/textarea'
import { toast } from '@/app/components/base/ui/toast'
import AppsFull from '@/app/components/billing/apps-full-in-dialog'
import { usePluginDependencies } from '@/app/components/workflow/plugin-dependency/hooks'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import { useAppContext } from '@/context/app-context'
import { useProviderContext } from '@/context/provider-context'
import {
  DSLImportMode,
  DSLImportStatus,
} from '@/models/app'
import { useRouter } from '@/next/navigation'
import {
  createDSLRun,
  getDSLRun,
  importDSL,
  importDSLConfirm,
} from '@/service/apps'
import { getRedirection } from '@/utils/app-redirection'
import { cn } from '@/utils/classnames'
import ShortcutsName from '../../workflow/shortcuts-name'
import Uploader from './uploader'

type CreateFromDSLModalProps = {
  show: boolean
  onSuccess?: () => void
  onClose: () => void
  activeTab?: string
  dslUrl?: string
  droppedFile?: File
}

export const CreateFromDSLModalTab = {
  FROM_FILE: 'from-file',
  FROM_URL: 'from-url',
  FROM_AI: 'from-ai',
} as const

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

const CreateFromDSLModal = ({ show, onSuccess, onClose, activeTab = CreateFromDSLModalTab.FROM_FILE, dslUrl = '', droppedFile }: CreateFromDSLModalProps) => {
  const { push } = useRouter()
  const { t } = useTranslation()
  const [currentFile, setCurrentFile] = useState<File | undefined>(droppedFile)
  const [fileContent, setFileContent] = useState<string>()
  const [currentTab, setCurrentTab] = useState(activeTab)
  const [dslUrlValue, setDslUrlValue] = useState(dslUrl)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiAppName, setAiAppName] = useState('')
  const [aiProvider, setAiProvider] = useState('langgenius/openai/openai')
  const [aiModel, setAiModel] = useState('gpt-4o-mini')
  const [generatedYaml, setGeneratedYaml] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [dslAgentStageState, setDslAgentStageState] = useState<DslAgentStageState>({ completed: [] })
  const [showErrorModal, setShowErrorModal] = useState(false)
  const [versions, setVersions] = useState<{ importedVersion: string, systemVersion: string }>()
  const [importId, setImportId] = useState<string>()
  const { handleCheckPluginDependencies } = usePluginDependencies()

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
      provider: aiProvider.trim() || undefined,
      model: aiModel.trim() || undefined,
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

  const readFile = useCallback((file: File) => {
    const reader = new FileReader()
    reader.onload = function (event) {
      const content = event.target?.result
      setFileContent(content as string)
    }
    reader.readAsText(file)
  }, [])

  const handleFile = useCallback((file?: File) => {
    setCurrentFile(file)
    if (file)
      readFile(file)
    if (!file)
      setFileContent('')
  }, [readFile])

  const { isCurrentWorkspaceEditor } = useAppContext()
  const { plan, enableBilling } = useProviderContext()
  const isAppsFull = (enableBilling && plan.usage.buildApps >= plan.total.buildApps)

  const isCreatingRef = useRef(false)

  useEffect(() => {
    if (droppedFile)
      handleFile(droppedFile)
  }, [droppedFile, handleFile])

  const onCreate = async (_e?: React.MouseEvent) => {
    if (currentTab === CreateFromDSLModalTab.FROM_FILE && !currentFile)
      return
    if (currentTab === CreateFromDSLModalTab.FROM_URL && !dslUrlValue)
      return
    if (currentTab === CreateFromDSLModalTab.FROM_AI && !aiPrompt.trim())
      return
    if (isCreatingRef.current)
      return
    isCreatingRef.current = true
    setIsCreating(true)
    if (currentTab === CreateFromDSLModalTab.FROM_AI) {
      setGeneratedYaml('')
      resetDslAgentProgress()
    }
    try {
      let response

      if (currentTab === CreateFromDSLModalTab.FROM_FILE) {
        response = await importDSL({
          mode: DSLImportMode.YAML_CONTENT,
          yaml_content: fileContent || '',
        })
      }
      if (currentTab === CreateFromDSLModalTab.FROM_URL) {
        response = await importDSL({
          mode: DSLImportMode.YAML_URL,
          yaml_url: dslUrlValue || '',
        })
      }
      if (currentTab === CreateFromDSLModalTab.FROM_AI) {
        const generated = await createAndPollDslAgentRun()
        setGeneratedYaml(generated.yaml_content)
        startDslAgentStage(DslAgentStage.IMPORT)
        response = await importDSL({
          mode: DSLImportMode.YAML_CONTENT,
          yaml_content: generated.yaml_content,
          name: generated.name,
          description: generated.description,
        })
        completeDslAgentStage(DslAgentStage.IMPORT)
      }

      if (!response)
        return
      const { id, status, app_id, app_mode, imported_dsl_version, current_dsl_version } = response
      if (status === DSLImportStatus.COMPLETED || status === DSLImportStatus.COMPLETED_WITH_WARNINGS) {
        const creationMethod = currentTab === CreateFromDSLModalTab.FROM_FILE
          ? 'dsl_file'
          : currentTab === CreateFromDSLModalTab.FROM_URL
            ? 'dsl_url'
            : 'dsl_agent'
        // Track app creation from DSL import
        trackEvent('create_app_with_dsl', {
          app_mode,
          creation_method: creationMethod,
          has_warnings: status === DSLImportStatus.COMPLETED_WITH_WARNINGS,
        })

        if (currentTab !== CreateFromDSLModalTab.FROM_AI && onSuccess)
          onSuccess()
        if (currentTab !== CreateFromDSLModalTab.FROM_AI && onClose)
          onClose()

        toast(t(status === DSLImportStatus.COMPLETED ? 'newApp.appCreated' : 'newApp.caution', { ns: 'app' }), {
          type: status === DSLImportStatus.COMPLETED ? 'success' : 'warning',
          description: status === DSLImportStatus.COMPLETED_WITH_WARNINGS
            ? t('newApp.appCreateDSLWarning', { ns: 'app' })
            : undefined,
        })
        localStorage.setItem(NEED_REFRESH_APP_LIST_KEY, '1')
        if (app_id) {
          if (currentTab === CreateFromDSLModalTab.FROM_AI)
            startDslAgentStage(DslAgentStage.DEPENDENCIES)
          await handleCheckPluginDependencies(app_id)
          if (currentTab === CreateFromDSLModalTab.FROM_AI)
            completeDslAgentStage(DslAgentStage.DEPENDENCIES)
        }
        if (currentTab === CreateFromDSLModalTab.FROM_AI && onSuccess)
          onSuccess()
        if (currentTab === CreateFromDSLModalTab.FROM_AI && onClose)
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
        if (currentTab === CreateFromDSLModalTab.FROM_AI)
          failDslAgentStage(DslAgentStage.IMPORT)
        toast.error(t('newApp.appCreateFailed', { ns: 'app' }))
      }
    }
    // eslint-disable-next-line unused-imports/no-unused-vars
    catch (e) {
      if (currentTab === CreateFromDSLModalTab.FROM_AI)
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
    if (show && !isAppsFull && ((currentTab === CreateFromDSLModalTab.FROM_FILE && currentFile) || (currentTab === CreateFromDSLModalTab.FROM_URL && dslUrlValue) || (currentTab === CreateFromDSLModalTab.FROM_AI && aiPrompt.trim())))
      handleCreateApp(undefined)
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
    // eslint-disable-next-line unused-imports/no-unused-vars
    catch (e) {
      toast.error(t('newApp.appCreateFailed', { ns: 'app' }))
    }
  }

  const tabs = [
    {
      key: CreateFromDSLModalTab.FROM_FILE,
      label: t('importFromDSLFile', { ns: 'app' }),
    },
    {
      key: CreateFromDSLModalTab.FROM_URL,
      label: t('importFromDSLUrl', { ns: 'app' }),
    },
  ]

  const buttonDisabled = useMemo(() => {
    if (isAppsFull)
      return true
    if (isCreating)
      return true
    if (currentTab === CreateFromDSLModalTab.FROM_FILE)
      return !currentFile
    if (currentTab === CreateFromDSLModalTab.FROM_URL)
      return !dslUrlValue
    if (currentTab === CreateFromDSLModalTab.FROM_AI)
      return !aiPrompt.trim()
    return false
  }, [isAppsFull, isCreating, currentTab, currentFile, dslUrlValue, aiPrompt])

  const shouldShowDslAgentProgress = currentTab === CreateFromDSLModalTab.FROM_AI && (
    isCreating
    || !!generatedYaml
    || dslAgentStageState.completed.length > 0
    || !!dslAgentStageState.failed
  )

  return (
    <>
      <Modal
        className="w-[520px] rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-0 shadow-xl"
        isShow={show}
        onClose={noop}
      >
        <div className="flex items-center justify-between pt-6 pr-5 pb-3 pl-6 title-2xl-semi-bold text-text-primary">
          {t('importFromDSL', { ns: 'app' })}
          <div
            className="flex h-8 w-8 cursor-pointer items-center"
            onClick={() => onClose()}
          >
            <span className="i-ri-close-line h-5 w-5 text-text-tertiary" />
          </div>
        </div>
        <div className="flex h-9 items-center space-x-6 border-b border-divider-subtle px-6 system-md-semibold text-text-tertiary">
          {
            tabs.map(tab => (
              <div
                key={tab.key}
                className={cn(
                  'relative flex h-full cursor-pointer items-center',
                  currentTab === tab.key && 'text-text-primary',
                )}
                onClick={() => setCurrentTab(tab.key)}
              >
                {tab.label}
                {
                  currentTab === tab.key && (
                    <div className="absolute bottom-0 h-[2px] w-full bg-util-colors-blue-brand-blue-brand-600"></div>
                  )
                }
              </div>
            ))
          }
        </div>
        <div className="px-6 py-4">
          {
            currentTab === CreateFromDSLModalTab.FROM_FILE && (
              <Uploader
                className="mt-0"
                file={currentFile}
                updateFile={handleFile}
              />
            )
          }
          {
            currentTab === CreateFromDSLModalTab.FROM_URL && (
              <div>
                <div className="mb-1 system-md-semibold text-text-secondary">DSL URL</div>
                <Input
                  placeholder={t('importFromDSLUrlPlaceholder', { ns: 'app' }) || ''}
                  value={dslUrlValue}
                  onChange={e => setDslUrlValue(e.target.value)}
                />
              </div>
            )
          }
          {
            currentTab === CreateFromDSLModalTab.FROM_AI && (
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
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="mb-1 system-md-semibold text-text-secondary">{t('newApp.dslAgentProvider', { ns: 'app' })}</div>
                    <Input
                      value={aiProvider}
                      onChange={e => setAiProvider(e.target.value)}
                    />
                  </div>
                  <div>
                    <div className="mb-1 system-md-semibold text-text-secondary">{t('newApp.dslAgentModel', { ns: 'app' })}</div>
                    <Input
                      value={aiModel}
                      onChange={e => setAiModel(e.target.value)}
                    />
                  </div>
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
            )
          }
        </div>
        {isAppsFull && (
          <div className="px-6">
            <AppsFull className="mt-0" loc="app-create-dsl" />
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
            {isCreating && currentTab === CreateFromDSLModalTab.FROM_AI && <span className="i-ri-loader-2-line h-4 w-4 animate-spin" />}
            <span>{isCreating && currentTab === CreateFromDSLModalTab.FROM_AI ? t('newApp.dslAgentWorking', { ns: 'app' }) : t('newApp.Create', { ns: 'app' })}</span>
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

export default CreateFromDSLModal
