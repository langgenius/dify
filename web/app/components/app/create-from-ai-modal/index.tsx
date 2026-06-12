'use client'

import type { MouseEventHandler } from 'react'
import type { DefaultModel } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type {
  DSLAgentDraftRepairResponse,
  DSLAgentRunResponse,
  DSLGenerateResponse,
  DSLImportResponse,
} from '@/models/app'
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
import { createDSLRun, debugAndRepairDSLAgentDraftRun, getDSLRun, importDSL, importDSLConfirm } from '@/service/apps'
import { AppModeEnum } from '@/types/app'
import { getRedirection } from '@/utils/app-redirection'
import { cn } from '@/utils/classnames'
import { parsePluginErrorMessage } from '@/utils/error-parser'
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
  TEST: 'test',
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
  DslAgentStage.TEST,
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

type ImportedAppState = {
  id: string
  mode: DSLImportResponse['app_mode']
}

type ManualSetupItem = {
  id: string
  title: string
  description: string
}

const APP_TYPE_OPTIONS = [
  {
    mode: AppModeEnum.WORKFLOW,
    label: 'newApp.dslAgentAppModeWorkflow',
  },
  {
    mode: AppModeEnum.ADVANCED_CHAT,
    label: 'newApp.dslAgentAppModeChatflow',
  },
]

const sleep = (timeout: number) => new Promise(resolve => setTimeout(resolve, timeout))

const compactYamlForPrompt = (yaml: string) => {
  const trimmed = yaml.trim()
  if (trimmed.length <= 6000)
    return trimmed
  return `${trimmed.slice(0, 6000)}\n# ... truncated for refinement context ...`
}

const redactSecretLikeText = (value: string) => {
  return value
    .replace(/\bBearer\s+[\w.-]{12,}/gi, 'Bearer [redacted]')
    .replace(/\b(sk-[\w-]{12,})\b/g, '[redacted]')
    .replace(/\b(xox[baprs]-[\w-]{10,})\b/g, '[redacted]')
    .replace(/((?:api[_\s-]?key|token|secret|password|credential)\s*[:=]\s*)([^\s,;]+)/gi, '$1[redacted]')
}

const buildStructuredRequirement = (
  basePrompt: string,
  appMode: AppModeEnum,
  currentYaml?: string,
) => {
  const sections: string[] = []
  const prompt = basePrompt.trim()
  if (prompt)
    sections.push(redactSecretLikeText(prompt))

  sections.push(`Target app type: ${appMode}.`)

  if (currentYaml?.trim()) {
    sections.push([
      'Current DSL to refine:',
      '```yaml',
      compactYamlForPrompt(currentYaml),
      '```',
    ].join('\n'))
  }

  return sections.join('\n\n')
}

const dependencyLabel = (dependency: unknown) => {
  if (!dependency || typeof dependency !== 'object')
    return ''
  const value = 'value' in dependency ? (dependency as { value?: unknown }).value : undefined
  if (value && typeof value === 'object') {
    const uniqueIdentifier = 'unique_identifier' in value ? (value as { unique_identifier?: unknown }).unique_identifier : undefined
    if (typeof uniqueIdentifier === 'string' && uniqueIdentifier)
      return uniqueIdentifier
    const manifest = 'manifest' in value ? (value as { manifest?: unknown }).manifest : undefined
    if (manifest && typeof manifest === 'object') {
      const name = 'name' in manifest ? (manifest as { name?: unknown }).name : undefined
      if (typeof name === 'string' && name)
        return name
    }
  }
  const marketplace = 'marketplace_plugin_unique_identifier' in dependency
    ? (dependency as { marketplace_plugin_unique_identifier?: unknown }).marketplace_plugin_unique_identifier
    : undefined
  if (typeof marketplace === 'string' && marketplace)
    return marketplace
  const packageName = 'package' in dependency ? (dependency as { package?: unknown }).package : undefined
  if (typeof packageName === 'string' && packageName)
    return packageName
  return ''
}

const CreateFromAIModal = ({ show, onSuccess, onClose }: CreateFromAIModalProps) => {
  const { push } = useRouter()
  const { t } = useTranslation()
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiAppName, setAiAppName] = useState('')
  const [selectedAppMode, setSelectedAppMode] = useState<AppModeEnum>(AppModeEnum.WORKFLOW)
  const [selectedModel, setSelectedModel] = useState<DefaultModel>()
  const [generatedResult, setGeneratedResult] = useState<DSLGenerateResponse>()
  const [generatedYaml, setGeneratedYaml] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [dslAgentStageState, setDslAgentStageState] = useState<DslAgentStageState>({ completed: [] })
  const [showErrorModal, setShowErrorModal] = useState(false)
  const [versions, setVersions] = useState<{ importedVersion: string, systemVersion: string }>()
  const [importId, setImportId] = useState<string>()
  const [importedApp, setImportedApp] = useState<ImportedAppState>()
  const [importedDependencies, setImportedDependencies] = useState<DSLImportResponse['leaked_dependencies']>([])
  const [debugRepairResult, setDebugRepairResult] = useState<DSLAgentDraftRepairResponse>()
  const [builderNotice, setBuilderNotice] = useState('')
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
  const isBusy = isCreating || isTesting
  const hasRequirement = !!aiPrompt.trim()
  const currentDslAgentActionLabel = useMemo(() => {
    if (!isBusy)
      return generatedYaml ? t('newApp.dslAgentRefineAndImport', { ns: 'app' }) : t('newApp.dslAgentGenerateAndImport', { ns: 'app' })
    if (dslAgentStageState.active)
      return t(`newApp.dslAgentStage.${dslAgentStageState.active}`, { ns: 'app' })
    return t('newApp.dslAgentWorking', { ns: 'app' })
  }, [dslAgentStageState.active, generatedYaml, isBusy, t])

  const manualSetupItems = useMemo<ManualSetupItem[]>(() => {
    const items: ManualSetupItem[] = []
    const addItem = (id: string, title: string, description: string) => {
      if (items.some(item => item.id === id))
        return
      items.push({ id, title, description })
    }

    if (activeModel) {
      addItem(
        'model',
        t('newApp.dslAgentChecklist.model', { ns: 'app' }),
        `${activeModel.provider} / ${activeModel.model}`,
      )
    }

    for (const [index, dependency] of importedDependencies.entries()) {
      const label = dependencyLabel(dependency)
      if (label) {
        addItem(
          `plugin-${index}-${label}`,
          t('newApp.dslAgentChecklist.plugin', { ns: 'app' }),
          label,
        )
      }
    }

    const plan = generatedResult?.metadata?.plan
    const marketplacePluginId = plan && typeof plan === 'object' && 'marketplace_plugin_id' in plan
      ? (plan as { marketplace_plugin_id?: unknown }).marketplace_plugin_id
      : undefined
    if (typeof marketplacePluginId === 'string' && marketplacePluginId) {
      addItem(
        `plugin-${marketplacePluginId}`,
        t('newApp.dslAgentChecklist.plugin', { ns: 'app' }),
        marketplacePluginId,
      )
    }

    const lowerYaml = generatedYaml.toLowerCase()
    const promptLower = aiPrompt.toLowerCase()
    if (
      lowerYaml.includes('knowledge-retrieval')
      || lowerYaml.includes('dataset_ids')
      || promptLower.includes('dataset')
      || promptLower.includes('knowledge')
      || promptLower.includes('file')
      || promptLower.includes('data source')
      || promptLower.includes('数据')
      || promptLower.includes('知识库')
      || promptLower.includes('文件')
    ) {
      addItem(
        'dataset',
        t('newApp.dslAgentChecklist.dataset', { ns: 'app' }),
        t('newApp.dslAgentChecklist.datasetDetail', { ns: 'app' }),
      )
    }
    if (
      lowerYaml.includes('credential')
      || lowerYaml.includes('api_key')
      || promptLower.includes('credential')
      || promptLower.includes('api key')
      || promptLower.includes('oauth')
      || promptLower.includes('token')
      || promptLower.includes('secret')
      || promptLower.includes('凭据')
      || promptLower.includes('密钥')
    ) {
      addItem(
        'credential',
        t('newApp.dslAgentChecklist.credential', { ns: 'app' }),
        t('newApp.dslAgentChecklist.credentialDetail', { ns: 'app' }),
      )
    }
    if (lowerYaml.includes('environment_variables:') && !lowerYaml.includes('environment_variables: []')) {
      addItem(
        'environment',
        t('newApp.dslAgentChecklist.environment', { ns: 'app' }),
        t('newApp.dslAgentChecklist.environmentDetail', { ns: 'app' }),
      )
    }
    if (promptLower.includes('test input') || promptLower.includes('mock input') || promptLower.includes('测试输入')) {
      addItem(
        'test-input',
        t('newApp.dslAgentChecklist.testInput', { ns: 'app' }),
        t('newApp.dslAgentChecklist.testInputDetail', { ns: 'app' }),
      )
    }

    if (!items.length) {
      addItem(
        'pending',
        t('newApp.dslAgentChecklist.pending', { ns: 'app' }),
        t('newApp.dslAgentChecklist.pendingDetail', { ns: 'app' }),
      )
    }

    return items
  }, [activeModel, aiPrompt, generatedResult, generatedYaml, importedDependencies, t])

  const resetDslAgentProgress = () => {
    setDslAgentStageState({ completed: [], messages: {} })
  }

  const resetBuilderSession = () => {
    if (isBusy)
      return
    setAiPrompt('')
    setAiAppName('')
    setSelectedAppMode(AppModeEnum.WORKFLOW)
    setGeneratedResult(undefined)
    setGeneratedYaml('')
    setImportedApp(undefined)
    setImportedDependencies([])
    setDebugRepairResult(undefined)
    setBuilderNotice('')
    setVersions(undefined)
    setImportId(undefined)
    setShowErrorModal(false)
    resetDslAgentProgress()
  }

  const getDslAgentErrorMessage = async (error: unknown) => {
    const message = await parsePluginErrorMessage(error)
    if (message.toLowerCase().includes('failed to fetch'))
      return t('newApp.dslAgentApiUnavailable', { ns: 'app' })
    return message
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
    const prompt = buildStructuredRequirement(aiPrompt.trim(), selectedAppMode, generatedYaml)
    let run = await createDSLRun({
      prompt,
      app_name: aiAppName.trim() || undefined,
      app_mode: selectedAppMode,
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

  const applyImportedApp = (response: DSLImportResponse) => {
    if (response.app_id)
      setImportedApp({ id: response.app_id, mode: response.app_mode })
    setImportedDependencies(response.leaked_dependencies || [])
  }

  const checkImportedAppDependencies = async (appId: string) => {
    startDslAgentStage(DslAgentStage.DEPENDENCIES)
    try {
      await handleCheckPluginDependencies(appId)
      completeDslAgentStage(DslAgentStage.DEPENDENCIES)
    }
    catch (error) {
      const message = await parsePluginErrorMessage(error)
      completeDslAgentStage(DslAgentStage.DEPENDENCIES, t('newApp.dslAgentDependencyCheckWarning', { ns: 'app' }))
      toast.warning(
        t('newApp.dslAgentDependencyCheckWarning', { ns: 'app' }),
        message ? { description: message } : undefined,
      )
    }
  }

  const onCreate = async () => {
    if (!hasRequirement || !activeModel)
      return
    if (isCreatingRef.current)
      return
    isCreatingRef.current = true
    setIsCreating(true)
    setGeneratedResult(undefined)
    setGeneratedYaml('')
    setImportedApp(undefined)
    setImportedDependencies([])
    setDebugRepairResult(undefined)
    setBuilderNotice('')
    resetDslAgentProgress()

    // Once the app is imported, post-create steps (dependency check, redirect,
    // onSuccess/onClose) must not surface a "create failed" error.
    let appCreated = false
    try {
      const generated = await createAndPollDslAgentRun()
      setGeneratedResult(generated)
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
        appCreated = true
        applyImportedApp(response)
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
        if (app_id)
          await checkImportedAppDependencies(app_id)
        if (onSuccess)
          onSuccess()
        setBuilderNotice(t('newApp.dslAgentImportedNotice', { ns: 'app' }))
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
    catch (error) {
      // The app was already created; a post-create step (redirect, callbacks)
      // failed. Don't show a misleading "create failed" error.
      if (appCreated) {
        console.error('DSL agent post-create step failed', error)
        return
      }
      const message = await getDslAgentErrorMessage(error)
      failDslAgentStage(undefined, message)
      toast.error(
        t('newApp.appCreateFailed', { ns: 'app' }),
        message ? { description: message } : undefined,
      )
    }
    finally {
      isCreatingRef.current = false
      setIsCreating(false)
    }
  }

  const { run: handleCreateApp } = useDebounceFn(onCreate, { wait: 300 })

  const handleOpenImportedApp = () => {
    if (!importedApp)
      return
    getRedirection(isCurrentWorkspaceEditor, { id: importedApp.id, mode: importedApp.mode }, push)
    onClose()
  }

  const buildDraftRunInput = () => {
    const testInput = redactSecretLikeText(aiPrompt.trim() || 'Hello')
    return {
      inputs: {
        input: testInput,
      },
      query: testInput,
      include_events: true,
    }
  }

  const insertRequirementTemplate = () => {
    const template = t('newApp.dslAgentPromptTemplate', { ns: 'app' })
    setAiPrompt(prev => prev.trim() ? `${prev.trim()}\n\n${template}` : template)
  }

  const runDraftRepair = (appId: string, yamlContent: string, validation?: Record<string, unknown>) => {
    return debugAndRepairDSLAgentDraftRun(appId, {
      ...buildDraftRunInput(),
      yaml_content: yamlContent,
      validation,
    })
  }

  const executeAndRepair = async () => {
    if (!importedApp || !generatedYaml || isBusy)
      return
    setIsTesting(true)
    setDebugRepairResult(undefined)
    setBuilderNotice('')
    try {
      startDslAgentStage(DslAgentStage.TEST)
      const result = await runDraftRepair(
        importedApp.id,
        generatedYaml,
        generatedResult?.metadata?.validation as Record<string, unknown> | undefined,
      )
      setDebugRepairResult(result)

      if (!result.needs_repair) {
        completeDslAgentStage(DslAgentStage.TEST, t('newApp.dslAgentTestPassedNotice', { ns: 'app' }))
        setBuilderNotice(t('newApp.dslAgentTestPassedNotice', { ns: 'app' }))
        toast.success(t('newApp.dslAgentTestPassedNotice', { ns: 'app' }))
        return
      }

      completeDslAgentStage(DslAgentStage.TEST, t('newApp.dslAgentTestFoundIssuesNotice', { ns: 'app' }))
      if (!result.repair.changed || !result.repair.yaml_content) {
        failDslAgentStage(DslAgentStage.REPAIR, t('newApp.dslAgentRepairNoChangeNotice', { ns: 'app' }))
        setBuilderNotice(t('newApp.dslAgentRepairNoChangeNotice', { ns: 'app' }))
        return
      }

      startDslAgentStage(DslAgentStage.REPAIR)
      setGeneratedYaml(result.repair.yaml_content)
      setGeneratedResult(prev => prev
        ? { ...prev, yaml_content: result.repair.yaml_content, metadata: { ...prev.metadata, validation: result.repair.validation, repair: result.repair.repair } }
        : prev)
      completeDslAgentStage(DslAgentStage.REPAIR, t('newApp.dslAgentRepairGeneratedNotice', { ns: 'app' }))

      startDslAgentStage(DslAgentStage.IMPORT)
      const imported = await importDSL({
        mode: DSLImportMode.YAML_CONTENT,
        yaml_content: result.repair.yaml_content,
        app_id: importedApp.id,
        name: generatedResult?.name,
        description: generatedResult?.description,
      })
      if (imported.status === DSLImportStatus.COMPLETED || imported.status === DSLImportStatus.COMPLETED_WITH_WARNINGS) {
        applyImportedApp(imported)
        completeDslAgentStage(DslAgentStage.IMPORT, t('newApp.dslAgentRepairImportedNotice', { ns: 'app' }))
        setBuilderNotice(t('newApp.dslAgentRepairImportedNotice', { ns: 'app' }))
        localStorage.setItem(NEED_REFRESH_APP_LIST_KEY, '1')
        onSuccess?.()
      }
      else if (imported.status === DSLImportStatus.PENDING) {
        setVersions({
          importedVersion: imported.imported_dsl_version ?? '',
          systemVersion: imported.current_dsl_version ?? '',
        })
        setImportId(imported.id)
        setShowErrorModal(true)
        return
      }
      else {
        failDslAgentStage(DslAgentStage.IMPORT)
        return
      }

      const verifiedAppId = imported.app_id || importedApp.id
      startDslAgentStage(DslAgentStage.TEST, t('newApp.dslAgentRepairRetestNotice', { ns: 'app' }))
      const verifyResult = await runDraftRepair(verifiedAppId, result.repair.yaml_content, result.repair.validation)
      setDebugRepairResult(verifyResult)
      if (!verifyResult.needs_repair) {
        completeDslAgentStage(DslAgentStage.TEST, t('newApp.dslAgentRepairVerifiedNotice', { ns: 'app' }))
        setBuilderNotice(t('newApp.dslAgentRepairVerifiedNotice', { ns: 'app' }))
        toast.success(t('newApp.dslAgentRepairVerifiedNotice', { ns: 'app' }))
        return
      }

      completeDslAgentStage(DslAgentStage.TEST, t('newApp.dslAgentRepairStillFailingNotice', { ns: 'app' }))
      if (!verifyResult.repair.changed || !verifyResult.repair.yaml_content) {
        failDslAgentStage(DslAgentStage.REPAIR, t('newApp.dslAgentRepairNoChangeNotice', { ns: 'app' }))
        setBuilderNotice(t('newApp.dslAgentRepairNoChangeNotice', { ns: 'app' }))
        return
      }
      setBuilderNotice(t('newApp.dslAgentRepairStillFailingNotice', { ns: 'app' }))
    }
    catch (error) {
      const message = await getDslAgentErrorMessage(error)
      failDslAgentStage(DslAgentStage.TEST, message)
      toast.error(
        t('newApp.dslAgentExecuteRepairFailed', { ns: 'app' }),
        message ? { description: message } : undefined,
      )
    }
    finally {
      setIsTesting(false)
    }
  }

  useKeyPress(['meta.enter', 'ctrl.enter'], () => {
    if (show && !isAppsFull && hasRequirement && activeModel)
      handleCreateApp()
  })

  useKeyPress('esc', () => {
    if (show && !showErrorModal)
      onClose()
  })

  const onDSLConfirm: MouseEventHandler = async () => {
    let appCreated = false
    try {
      if (!importId)
        return
      const response = await importDSLConfirm({
        import_id: importId,
      })

      const { status, app_id } = response

      if (status === DSLImportStatus.COMPLETED) {
        appCreated = true
        applyImportedApp(response)
        toast.success(t('newApp.appCreated', { ns: 'app' }))
        if (app_id)
          await checkImportedAppDependencies(app_id)
        localStorage.setItem(NEED_REFRESH_APP_LIST_KEY, '1')
        setBuilderNotice(t('newApp.dslAgentImportedNotice', { ns: 'app' }))
        if (onSuccess)
          onSuccess()
      }
      else if (status === DSLImportStatus.FAILED) {
        toast.error(t('newApp.appCreateFailed', { ns: 'app' }))
      }
    }
    catch (error) {
      if (appCreated) {
        console.error('DSL agent post-create step failed', error)
        return
      }
      const message = await getDslAgentErrorMessage(error)
      toast.error(
        t('newApp.appCreateFailed', { ns: 'app' }),
        message ? { description: message } : undefined,
      )
    }
  }

  const buttonDisabled = isAppsFull || isBusy || !hasRequirement || !activeModel
  const executeRepairDisabled = isBusy || !importedApp || !generatedYaml

  const shouldShowDslAgentProgress = isCreating
    || isTesting
    || !!generatedYaml
    || dslAgentStageState.completed.length > 0
    || !!dslAgentStageState.failed

  return (
    <>
      <Modal
        className="flex max-h-[calc(100vh-32px)] max-w-[960px] flex-col rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-0 shadow-xl"
        isShow={show}
        onClose={noop}
        overflowVisible
        highPriority
      >
        <div className="flex shrink-0 items-center justify-between pt-6 pr-5 pb-3 pl-6 title-2xl-semi-bold text-text-primary">
          {t('newApp.startFromAI', { ns: 'app' })}
          <div
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg hover:bg-state-base-hover"
            onClick={() => onClose()}
          >
            <span className="i-ri-close-line h-5 w-5 text-text-tertiary" />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <div className="mb-1 system-md-semibold text-text-secondary">{t('newApp.dslAgentAppMode', { ns: 'app' })}</div>
                  <div className="grid w-full grid-cols-2 rounded-lg bg-background-section-burn p-1">
                    {APP_TYPE_OPTIONS.map(option => (
                      <button
                        key={option.mode}
                        type="button"
                        className={cn(
                          'h-9 rounded-md px-3 system-sm-medium transition-colors',
                          selectedAppMode === option.mode
                            ? 'bg-components-panel-bg text-text-primary shadow-xs'
                            : 'text-text-tertiary hover:text-text-secondary',
                        )}
                        onClick={() => setSelectedAppMode(option.mode)}
                      >
                        {t(option.label, { ns: 'app' })}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <div className="mb-1 system-md-semibold text-text-secondary">{t('newApp.dslAgentPrompt', { ns: 'app' })}</div>
                  <Textarea
                    className="min-h-[84px]"
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
                    triggerClassName="h-10 gap-2 px-2"
                    popupClassName="!z-[1200]"
                    popupPlacement="top-start"
                    positionerProps={{
                      collisionAvoidance: {
                        side: 'shift',
                        align: 'shift',
                        fallbackAxisSide: 'none',
                      },
                    }}
                    onSelect={setSelectedModel}
                  />
                </div>
              </div>

              <div>
                <button
                  type="button"
                  className="flex h-8 items-center gap-1 rounded-lg px-2 system-sm-medium text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary"
                  onClick={insertRequirementTemplate}
                >
                  <span className="i-ri-add-line h-4 w-4" />
                  {t('newApp.dslAgentInsertTemplate', { ns: 'app' })}
                </button>
              </div>

              {!!generatedYaml && (
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <div className="system-sm-semibold text-text-secondary">{t('newApp.dslAgentGeneratedYaml', { ns: 'app' })}</div>
                    {builderNotice && <div className="system-xs-medium text-text-tertiary">{builderNotice}</div>}
                  </div>
                  <div className="max-h-[180px] overflow-auto rounded-lg bg-background-section-burn p-2 font-mono text-[11px] leading-4 text-text-tertiary">
                    {generatedYaml}
                  </div>
                </div>
              )}

              {shouldShowDslAgentProgress && (
                <div className="rounded-lg border border-divider-subtle bg-background-section-burn p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="system-sm-semibold text-text-secondary">{t('newApp.dslAgentProgressTitle', { ns: 'app' })}</div>
                    {isBusy && (
                      <div className="system-xs-medium text-text-tertiary">{currentDslAgentActionLabel}</div>
                    )}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
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
                          <div className="min-w-0">
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

            <div className="space-y-3">
              <div className="rounded-lg border border-divider-subtle bg-background-section-burn p-3">
                <div className="mb-2 system-sm-semibold text-text-secondary">{t('newApp.dslAgentChecklistTitle', { ns: 'app' })}</div>
                <div className="space-y-2">
                  {manualSetupItems.map(item => (
                    <div key={item.id} className="flex gap-2">
                      <span className="mt-0.5 i-ri-checkbox-blank-circle-line h-3.5 w-3.5 shrink-0 text-text-quaternary" />
                      <div className="min-w-0">
                        <div className="system-xs-medium text-text-secondary">{item.title}</div>
                        <div className="system-xs-regular break-words text-text-tertiary">{item.description}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {debugRepairResult && (
                <div className="rounded-lg border border-divider-subtle bg-background-section-burn p-3">
                  <div className="mb-2 system-sm-semibold text-text-secondary">{t('newApp.dslAgentTestResultTitle', { ns: 'app' })}</div>
                  <div className="space-y-1 system-xs-regular text-text-tertiary">
                    <div className="flex justify-between gap-3">
                      <span>{t('newApp.dslAgentTestStatus', { ns: 'app' })}</span>
                      <span>{debugRepairResult.draft_run.summary.status || '-'}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span>{t('newApp.dslAgentTestEvents', { ns: 'app' })}</span>
                      <span>{debugRepairResult.draft_run.summary.event_count}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span>{t('newApp.dslAgentTestFailedNodes', { ns: 'app' })}</span>
                      <span>{debugRepairResult.draft_run.summary.failed_nodes.length}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span>{t('newApp.dslAgentRepairChanged', { ns: 'app' })}</span>
                      <span>{debugRepairResult.repair.changed ? t('newApp.dslAgentYes', { ns: 'app' }) : t('newApp.dslAgentNo', { ns: 'app' })}</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="rounded-lg border border-divider-subtle bg-background-section-burn p-3">
                <div className="mb-1 flex items-center gap-1 system-sm-semibold text-text-secondary">
                  <span className="i-ri-shield-check-line h-4 w-4 text-text-tertiary" />
                  {t('newApp.dslAgentPrivacyTitle', { ns: 'app' })}
                </div>
                <div className="system-xs-regular text-text-tertiary">
                  {t('newApp.dslAgentPrivacyDesc', { ns: 'app' })}
                </div>
              </div>
            </div>
          </div>
        </div>
        {isAppsFull && (
          <div className="px-6">
            <AppsFull className="mt-0" loc="app-create-ai" />
          </div>
        )}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-6 py-5">
          <Button disabled={isBusy} onClick={resetBuilderSession}>{t('newApp.dslAgentStartOver', { ns: 'app' })}</Button>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {importedApp && (
              <Button disabled={executeRepairDisabled} onClick={executeAndRepair}>
                {isTesting && <span className="mr-1 i-ri-loader-2-line h-4 w-4 animate-spin" />}
                {t('newApp.dslAgentExecuteAndRepair', { ns: 'app' })}
              </Button>
            )}
            {importedApp && (
              <Button onClick={handleOpenImportedApp}>{t('newApp.dslAgentOpenApp', { ns: 'app' })}</Button>
            )}
            <Button onClick={onClose}>{t('newApp.Cancel', { ns: 'app' })}</Button>
            <Button
              disabled={buttonDisabled}
              variant="primary"
              onClick={handleCreateApp}
              className="gap-1"
            >
              {isCreating && <span className="i-ri-loader-2-line h-4 w-4 animate-spin" />}
              <span>{currentDslAgentActionLabel}</span>
              {!isCreating && <ShortcutsName keys={['ctrl', '↵']} bgColor="white" />}
            </Button>
          </div>
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
