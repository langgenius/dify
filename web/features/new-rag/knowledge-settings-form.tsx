'use client'

import type {
  KnowledgeFsExternalAccessResponse,
  KnowledgeFsPermissionResponse,
  KnowledgeFsProductRetrievalProfile,
  KnowledgeFsProfileModelSelection,
  KnowledgeFsSettingsPayload,
  KnowledgeFsSettingsResponse,
  KnowledgeFsSpaceDetailResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { DefaultModel } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { Member } from '@/models/common'
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
import { cn } from '@langgenius/dify-ui/cn'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
import {
  NumberField,
  NumberFieldControls,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from '@langgenius/dify-ui/number-field'
import { Slider } from '@langgenius/dify-ui/slider'
import { Switch } from '@langgenius/dify-ui/switch'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIconPicker from '@/app/components/base/app-icon-picker'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { ModelSelector } from '@/app/components/header/account-setting/model-provider-page/model-selector'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { KnowledgeModelReadinessNotice } from './components/knowledge-model-readiness-notice'
import { KnowledgeSettingsMembers } from './components/knowledge-settings-members'
import {
  DEFAULT_KNOWLEDGE_SPACE_ICON_BACKGROUND,
  KnowledgeSpaceIcon,
} from './components/knowledge-space-icon'
import { RetrievalModeSegmentedControl } from './components/retrieval-mode-segmented-control'
import { KNOWLEDGE_DESCRIPTION_MAX_LENGTH, KNOWLEDGE_NAME_MAX_LENGTH } from './constants'
import { newKnowledgeListPath } from './routes'

const TOP_K_MIN = 1
const TOP_K_MAX = 10
const SCORE_THRESHOLD_MIN = 0
const SCORE_THRESHOLD_MAX = 1
const NAME_ERROR_ID = 'knowledge-name-error'
const DESCRIPTION_ERROR_ID = 'knowledge-description-error'
const API_ACCESS_DESCRIPTION_ID = 'knowledge-api-access-description'
const WORKFLOW_ACCESS_DESCRIPTION_ID = 'knowledge-workflow-access-description'
const REASONING_MODEL_LABEL_ID = 'knowledge-reasoning-model-label'
const REASONING_MODEL_ERROR_ID = 'knowledge-reasoning-model-error'
const EMBEDDING_MODEL_LABEL_ID = 'knowledge-embedding-model-label'
const EMBEDDING_MODEL_ERROR_ID = 'knowledge-embedding-model-error'
const RERANK_MODEL_LABEL_ID = 'knowledge-rerank-model-label'
const RERANK_MODEL_ERROR_ID = 'knowledge-rerank-model-error'

type BasicSaveSlice = 'members' | 'space'
type SaveErrorSlice = 'basic' | 'externalAccess' | 'settings'
type SaveError = {
  kind: 'generic' | 'permission'
  slice: SaveErrorSlice
}

type ExternalAccessDraft = {
  apiEnabled: boolean
  workflowEnabled: boolean
}

type SettingsDraft = {
  embeddingModel: DefaultModel | undefined
  reasoningModel: DefaultModel | undefined
  rerankModel: DefaultModel | undefined
  retrievalMode: KnowledgeFsProductRetrievalProfile['defaultMode']
  scoreThreshold: number
  scoreThresholdEnabled: boolean
  topK: number
}

type KnowledgeSettingsFormProps = {
  externalAccess: KnowledgeFsExternalAccessResponse
  members: Member[]
  permissions: KnowledgeFsPermissionResponse[]
  serverConflict?: boolean
  settings: KnowledgeFsSettingsResponse
  space: KnowledgeFsSpaceDetailResponse
  onDraftFinish?: () => void
  onDraftStart?: () => void
}

function pluginIdForModel(model: DefaultModel) {
  if (model.plugin_id) return model.plugin_id
  const [organization, pluginName] = model.provider.split('/').filter(Boolean)
  if (organization && pluginName) return `${organization}/${pluginName}`
  return model.provider ? `langgenius/${model.provider}` : ''
}

function canonicalProvider(pluginId: string, provider: string) {
  if (provider.includes('/')) return provider
  return `${pluginId}/${provider}`
}

function providerSlugForModel(model: DefaultModel) {
  const pluginId = pluginIdForModel(model)
  const canonicalPrefix = `${pluginId}/`
  if (model.provider.startsWith(canonicalPrefix))
    return model.provider.slice(canonicalPrefix.length)
  return model.provider.split('/').filter(Boolean).at(-1) ?? model.provider
}

function modelPayload(model: DefaultModel): KnowledgeFsProfileModelSelection {
  return {
    model: model.model,
    pluginId: pluginIdForModel(model),
    provider: providerSlugForModel(model),
  }
}

function modelFingerprint(model: DefaultModel | undefined) {
  return JSON.stringify(
    model
      ? {
          model: model.model,
          pluginId: pluginIdForModel(model),
          provider: providerSlugForModel(model),
        }
      : null,
  )
}

function retrievalFingerprint({
  mode,
  reasoningModel,
  rerankModel,
  scoreThreshold,
  scoreThresholdEnabled,
  topK,
}: {
  mode: KnowledgeFsProductRetrievalProfile['defaultMode']
  reasoningModel: DefaultModel | undefined
  rerankModel: DefaultModel | undefined
  scoreThreshold: number
  scoreThresholdEnabled: boolean
  topK: number
}) {
  return JSON.stringify({
    mode,
    reasoningModel: modelFingerprint(reasoningModel),
    rerankModel: modelFingerprint(rerankModel),
    scoreThreshold,
    scoreThresholdEnabled,
    topK,
  })
}

function sortedIds(ids: string[]) {
  return [...ids].sort().join(':')
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function SettingsRow({ children, label }: { children: React.ReactNode; label: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:gap-1">
      <div className="flex h-7 w-full shrink-0 items-center pt-1 system-sm-semibold text-text-secondary sm:w-45">
        {label}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function toDefaultEmbeddingModel(
  selection: KnowledgeFsSettingsResponse['embedding'],
): DefaultModel | undefined {
  if (!selection) return undefined
  return {
    model: selection.model,
    plugin_id: selection.plugin_id,
    provider: canonicalProvider(selection.plugin_id, selection.provider),
  }
}

function toDefaultReasoningModel(
  selection: KnowledgeFsSettingsResponse['retrieval'],
): DefaultModel | undefined {
  if (!selection) return undefined
  return {
    model: selection.reasoning_model.model,
    plugin_id: selection.reasoning_model.plugin_id,
    provider: canonicalProvider(
      selection.reasoning_model.plugin_id,
      selection.reasoning_model.provider,
    ),
  }
}

function toDefaultRerankModel(
  selection: KnowledgeFsSettingsResponse['retrieval'],
): DefaultModel | undefined {
  if (!selection?.rerank.model) return undefined
  return {
    model: selection.rerank.model.model,
    plugin_id: selection.rerank.model.pluginId,
    provider: canonicalProvider(selection.rerank.model.pluginId, selection.rerank.model.provider),
  }
}

export function KnowledgeSettingsForm({
  externalAccess,
  members,
  permissions,
  serverConflict = false,
  settings,
  space,
  onDraftFinish,
  onDraftStart,
}: KnowledgeSettingsFormProps) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const { t: tSettings } = useTranslation('datasetSettings')
  const { t: tAppDebug } = useTranslation('appDebug')
  const { t: tWorkflow } = useTranslation('workflow')
  const queryClient = useQueryClient()
  const router = useRouter()
  const { data: reasoningModelList } = useModelList(ModelTypeEnum.textGeneration)
  const { data: embeddingModelList } = useModelList(ModelTypeEnum.textEmbedding)
  const { data: rerankModelList } = useModelList(ModelTypeEnum.rerank)

  const initialName = space.technical_summary?.name ?? ''
  const initialDescription = space.technical_summary?.description ?? ''
  const initialIcon = space.technical_summary?.icon ?? '📙'
  const initialIconBackground =
    space.technical_summary?.icon_background ?? DEFAULT_KNOWLEDGE_SPACE_ICON_BACKGROUND
  const initialSelectedMemberIds = permissions
    .filter(
      (permission) =>
        permission.status === 'active' && permission.account_id !== space.owner_account_id,
    )
    .map((permission) => permission.account_id)
  const initialApiEnabled = externalAccess.service_api_enabled && externalAccess.agent_enabled
  const initialWorkflowEnabled = externalAccess.workflow_enabled
  const initialEmbeddingModel = toDefaultEmbeddingModel(settings.embedding)
  const initialReasoningModel = toDefaultReasoningModel(settings.retrieval)
  const initialRerankModel = toDefaultRerankModel(settings.retrieval)
  const initialRetrievalMode = settings.retrieval?.default_mode ?? 'fast'
  const initialTopK = clamp(settings.retrieval?.top_k ?? 3, TOP_K_MIN, TOP_K_MAX)
  const initialScoreThresholdEnabled = settings.retrieval?.score_threshold.enabled ?? false
  const initialScoreThreshold = clamp(
    settings.retrieval?.score_threshold.value ?? 0.5,
    SCORE_THRESHOLD_MIN,
    SCORE_THRESHOLD_MAX,
  )

  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription)
  const [icon, setIcon] = useState(initialIcon)
  const [iconBackground, setIconBackground] = useState(initialIconBackground)
  const [visibility, setVisibility] = useState(space.visibility)
  const [selectedMemberIds, setSelectedMemberIds] = useState(initialSelectedMemberIds)
  const [apiEnabled, setApiEnabled] = useState(initialApiEnabled)
  const [workflowEnabled, setWorkflowEnabled] = useState(initialWorkflowEnabled)
  const [embeddingModel, setEmbeddingModel] = useState(initialEmbeddingModel)
  const [reasoningModel, setReasoningModel] = useState(initialReasoningModel)
  const [rerankModel, setRerankModel] = useState(initialRerankModel)
  const [retrievalMode, setRetrievalMode] = useState(initialRetrievalMode)
  const [topK, setTopK] = useState(initialTopK)
  const [scoreThresholdEnabled, setScoreThresholdEnabled] = useState(initialScoreThresholdEnabled)
  const [scoreThreshold, setScoreThreshold] = useState(initialScoreThreshold)
  const [embeddingBaseline, setEmbeddingBaseline] = useState(() =>
    modelFingerprint(initialEmbeddingModel),
  )
  const [retrievalBaseline, setRetrievalBaseline] = useState(() =>
    retrievalFingerprint({
      mode: initialRetrievalMode,
      reasoningModel: initialReasoningModel,
      rerankModel: initialRerankModel,
      scoreThreshold: initialScoreThreshold,
      scoreThresholdEnabled: initialScoreThresholdEnabled,
      topK: initialTopK,
    }),
  )
  const [nameTouched, setNameTouched] = useState(false)
  const [saveError, setSaveError] = useState<SaveError>()
  const [isBasicRefreshing, setIsBasicRefreshing] = useState(false)
  const [pendingMigrationId, setPendingMigrationId] = useState<string>()
  const [pendingEmbeddingModel, setPendingEmbeddingModel] = useState<DefaultModel>()
  const [iconPickerOpen, setIconPickerOpen] = useState(false)
  const [embeddingDialogOpen, setEmbeddingDialogOpen] = useState(false)
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const deleteCancelRef = useRef<HTMLButtonElement>(null)
  const pendingNavigationRef = useRef<string | undefined>(undefined)
  const historyGuardArmedRef = useRef(false)
  const historyGuardReleaseRef = useRef(false)
  const browserBackPendingRef = useRef(false)
  const allowNavigationRef = useRef(false)
  const pendingExternalAccessRef = useRef<ExternalAccessDraft>({
    apiEnabled: initialApiEnabled,
    workflowEnabled: initialWorkflowEnabled,
  })
  const externalAccessBaselineRef = useRef<ExternalAccessDraft>({
    apiEnabled: initialApiEnabled,
    workflowEnabled: initialWorkflowEnabled,
  })
  const queuedExternalAccessDraftRef = useRef<ExternalAccessDraft | undefined>(undefined)
  const externalAccessSaveInFlightRef = useRef(false)
  const completedBasicSaveFingerprintsRef = useRef<Partial<Record<BasicSaveSlice, string>>>({})
  const handledMigrationIdRef = useRef<string | undefined>(undefined)
  const migratingSettingsDraftRef = useRef<SettingsDraft | undefined>(undefined)
  const pendingSettingsDraftRef = useRef<SettingsDraft | undefined>(undefined)
  const queuedSettingsDraftRef = useRef<SettingsDraft | undefined>(undefined)
  const resumeSettingsQueueAfterMigrationRef = useRef(false)
  const settingsSaveRunnerRef = useRef<(draft: SettingsDraft) => void>(() => undefined)
  const settingsSaveInFlightRef = useRef(false)
  const settingsDraftOwnsFormLockRef = useRef(false)
  const liveSettingsDraftRef = useRef<SettingsDraft>({
    embeddingModel: initialEmbeddingModel,
    reasoningModel: initialReasoningModel,
    rerankModel: initialRerankModel,
    retrievalMode: initialRetrievalMode,
    scoreThreshold: initialScoreThreshold,
    scoreThresholdEnabled: initialScoreThresholdEnabled,
    topK: initialTopK,
  })
  const embeddingBaselineRef = useRef(modelFingerprint(initialEmbeddingModel))
  const retrievalBaselineRef = useRef(
    retrievalFingerprint({
      mode: initialRetrievalMode,
      reasoningModel: initialReasoningModel,
      rerankModel: initialRerankModel,
      scoreThreshold: initialScoreThreshold,
      scoreThresholdEnabled: initialScoreThresholdEnabled,
      topK: initialTopK,
    }),
  )
  const basicDirtyRef = useRef(false)
  const settingsRevisionRef = useRef(settings.revision)
  const settingsPropRevisionRef = useRef(settings.revision)
  const settingsSaveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  if (settingsPropRevisionRef.current !== settings.revision) {
    settingsPropRevisionRef.current = settings.revision
    settingsRevisionRef.current = settings.revision
  }

  const canEdit = space.permission_keys.includes('knowledge_space_edit')
  const canManageAccess = space.permission_keys.includes('knowledge_space_access_config')
  const canDelete = space.permission_keys.includes('knowledge_space_delete')
  const initialModelSetup = !settings.active_profile_available
  const modelSetupReady = settings.active_profile_available
  const readinessFieldLabel = (field: KnowledgeFsSettingsResponse['issues'][number]['field']) => {
    if (field === 'embedding') return tSettings(($) => $['form.embeddingModel'])
    if (field === 'reasoning') return tCommon(($) => $['modelProvider.systemReasoningModel.key'])
    if (field === 'rerank') return tCommon(($) => $['modelProvider.rerankModel.key'])
    return t(($) => $['newKnowledge.overview.attention.modelReadiness.bindingMissing'])
  }

  const spaceDirty =
    name !== initialName ||
    description !== initialDescription ||
    icon !== initialIcon ||
    iconBackground !== initialIconBackground ||
    visibility !== space.visibility
  const membersDirty = sortedIds(selectedMemberIds) !== sortedIds(initialSelectedMemberIds)
  const currentEmbeddingFingerprint = modelFingerprint(embeddingModel)
  const currentRetrievalFingerprint = retrievalFingerprint({
    mode: retrievalMode,
    reasoningModel,
    rerankModel,
    scoreThreshold,
    scoreThresholdEnabled,
    topK,
  })
  const currentSettingsDraft: SettingsDraft = {
    embeddingModel,
    reasoningModel,
    rerankModel,
    retrievalMode,
    scoreThreshold,
    scoreThresholdEnabled,
    topK,
  }
  const embeddingDirty = currentEmbeddingFingerprint !== embeddingBaseline
  const retrievalDirty = currentRetrievalFingerprint !== retrievalBaseline
  const basicDirty = spaceDirty || membersDirty
  liveSettingsDraftRef.current = currentSettingsDraft
  basicDirtyRef.current = basicDirty
  const isDirty = basicDirty || embeddingDirty || retrievalDirty
  const nameInvalid = !name.trim()
  const descriptionInvalid = Array.from(description).length > KNOWLEDGE_DESCRIPTION_MAX_LENGTH
  const membersInvalid =
    canManageAccess && visibility === 'partial_members' && selectedMemberIds.length === 0

  const spaceMutation = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.patch.mutationOptions(),
  )
  const membersMutation = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.members.put.mutationOptions(),
  )
  const externalAccessMutation = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.externalAccess.put.mutationOptions(),
  )
  const settingsMutation = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.settings.patch.mutationOptions({
      context: { silent: true },
    }),
  )
  const migrationQuery = useQuery({
    ...consoleQuery.knowledgeFs.spaces.byControlSpaceId.settings.migrations.byMigrationId.get.queryOptions(
      {
        input: {
          params: {
            control_space_id: space.control_space_id,
            migration_id: pendingMigrationId ?? 'pending',
          },
        },
      },
    ),
    enabled: Boolean(pendingMigrationId),
    refetchInterval: (query) =>
      query.state.data?.run_state === 'queued' || query.state.data?.run_state === 'running'
        ? 2000
        : false,
  })
  const deleteMutation = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.delete.mutationOptions(),
  )
  const isBasicSaving = spaceMutation.isPending || membersMutation.isPending || isBasicRefreshing
  const isAnySavePending =
    isBasicSaving ||
    externalAccessMutation.isPending ||
    settingsMutation.isPending ||
    Boolean(pendingMigrationId)
  const basicFieldsDisabled = !canEdit || isBasicSaving
  const externalAccessDisabled = !canEdit || !canManageAccess || !modelSetupReady
  const retrievalFieldsDisabled = !canEdit || (!initialModelSetup && embeddingDirty)
  const saveDisabled =
    !basicDirty ||
    nameInvalid ||
    descriptionInvalid ||
    membersInvalid ||
    isBasicSaving ||
    serverConflict
  const startDraft = () => onDraftStart?.()
  const beginSettingsDraft = (patch: Partial<SettingsDraft>) => {
    if (!basicDirtyRef.current) settingsDraftOwnsFormLockRef.current = true
    onDraftStart?.()
    const draft = { ...liveSettingsDraftRef.current, ...patch }
    liveSettingsDraftRef.current = draft
    return draft
  }

  const resetDraft = () => {
    setName(initialName)
    setDescription(initialDescription)
    setIcon(initialIcon)
    setIconBackground(initialIconBackground)
    setVisibility(space.visibility)
    setSelectedMemberIds(initialSelectedMemberIds)
    setNameTouched(false)
    if (saveError?.slice === 'basic') setSaveError(undefined)
    onDraftFinish?.()
  }

  const invalidateSettingsQueries = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.get.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.permissions.get.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.externalAccess.get.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.settings.get.key(),
      }),
    ])
  }, [queryClient])

  useEffect(() => {
    if (!pendingMigrationId || handledMigrationIdRef.current === pendingMigrationId) return
    const migration = migrationQuery.data
    if (migration?.run_state === 'queued' || migration?.run_state === 'running') return

    if (migration?.run_state === 'succeeded') {
      handledMigrationIdRef.current = pendingMigrationId
      const savedDraft = migratingSettingsDraftRef.current
      if (savedDraft) {
        const savedEmbeddingFingerprint = modelFingerprint(savedDraft.embeddingModel)
        embeddingBaselineRef.current = savedEmbeddingFingerprint
        setEmbeddingBaseline(savedEmbeddingFingerprint)
      }
      if (savedDraft) {
        const savedRetrievalFingerprint = retrievalFingerprint({
          mode: savedDraft.retrievalMode,
          reasoningModel: savedDraft.reasoningModel,
          rerankModel: savedDraft.rerankModel,
          scoreThreshold: savedDraft.scoreThreshold,
          scoreThresholdEnabled: savedDraft.scoreThresholdEnabled,
          topK: savedDraft.topK,
        })
        retrievalBaselineRef.current = savedRetrievalFingerprint
        setRetrievalBaseline(savedRetrievalFingerprint)
      }
      void invalidateSettingsQueries().then(() => {
        migratingSettingsDraftRef.current = undefined
        if (!queuedSettingsDraftRef.current) pendingSettingsDraftRef.current = undefined
        resumeSettingsQueueAfterMigrationRef.current = Boolean(queuedSettingsDraftRef.current)
        setPendingMigrationId(undefined)
        if (
          !queuedSettingsDraftRef.current &&
          settingsDraftOwnsFormLockRef.current &&
          !basicDirtyRef.current
        ) {
          settingsDraftOwnsFormLockRef.current = false
          onDraftFinish?.()
        }
      })
      return
    }

    if (
      migrationQuery.isError ||
      migration?.run_state === 'failed' ||
      migration?.run_state === 'canceled'
    ) {
      handledMigrationIdRef.current = pendingMigrationId
      migratingSettingsDraftRef.current = undefined
      resumeSettingsQueueAfterMigrationRef.current = false
      // oxlint-disable-next-line eslint-react/set-state-in-effect -- A terminal remote migration retires the local polling guard.
      setPendingMigrationId(undefined)
      // oxlint-disable-next-line eslint-react/set-state-in-effect -- The authoritative failed migration transitions the save UI to its retry state.
      setSaveError({ kind: 'generic', slice: 'settings' })
    }
  }, [
    invalidateSettingsQueries,
    migrationQuery.data,
    migrationQuery.isError,
    onDraftFinish,
    pendingMigrationId,
  ])

  const performBasicSave = async () => {
    if (saveDisabled || !canEdit) return

    setSaveError(undefined)

    try {
      const saveSlice = async (
        slice: BasicSaveSlice,
        payload: unknown,
        save: () => Promise<unknown>,
      ) => {
        const fingerprint = JSON.stringify(payload)
        if (completedBasicSaveFingerprintsRef.current[slice] === fingerprint) return

        await save()
        completedBasicSaveFingerprintsRef.current[slice] = fingerprint
      }

      if (spaceDirty) {
        const body = {
          ...(description !== initialDescription ? { description } : {}),
          ...(icon !== initialIcon ? { icon } : {}),
          ...(iconBackground !== initialIconBackground ? { icon_background: iconBackground } : {}),
          ...(name !== initialName ? { name: name.trim() } : {}),
          ...(visibility !== space.visibility ? { visibility } : {}),
        }
        await saveSlice('space', body, () =>
          spaceMutation.mutateAsync({
            body,
            params: { control_space_id: space.control_space_id },
          }),
        )
      }
      if (membersDirty && canManageAccess) {
        const roleByAccountId = new Map(
          permissions.map((permission) => [permission.account_id, permission.role]),
        )
        const body = {
          members: selectedMemberIds.map((accountId) => ({
            account_id: accountId,
            role: roleByAccountId.get(accountId) ?? 'viewer',
          })),
        }
        await saveSlice('members', body, () =>
          membersMutation.mutateAsync({
            body,
            params: { control_space_id: space.control_space_id },
          }),
        )
      }
      completedBasicSaveFingerprintsRef.current = {}
      setIsBasicRefreshing(true)
      onDraftFinish?.()
      void invalidateSettingsQueries().then(
        () => setIsBasicRefreshing(false),
        () => setIsBasicRefreshing(false),
      )
    } catch {
      setSaveError({ kind: 'generic', slice: 'basic' })
    }
  }

  const performExternalAccessSave = async (draft: ExternalAccessDraft) => {
    pendingExternalAccessRef.current = draft
    if (!canEdit || !canManageAccess) return
    if (externalAccessSaveInFlightRef.current) {
      queuedExternalAccessDraftRef.current = draft
      return
    }

    externalAccessSaveInFlightRef.current = true
    let nextDraft: ExternalAccessDraft | undefined = draft
    while (nextDraft) {
      queuedExternalAccessDraftRef.current = undefined
      setSaveError(undefined)
      try {
        await externalAccessMutation.mutateAsync({
          body: {
            agent_enabled: nextDraft.apiEnabled,
            mcp_enabled: externalAccess.mcp_enabled,
            service_api_enabled: nextDraft.apiEnabled,
            workflow_enabled: nextDraft.workflowEnabled,
          },
          params: { control_space_id: space.control_space_id },
        })
        externalAccessBaselineRef.current = nextDraft
        nextDraft = queuedExternalAccessDraftRef.current
      } catch {
        queuedExternalAccessDraftRef.current = undefined
        externalAccessSaveInFlightRef.current = false
        setApiEnabled(externalAccessBaselineRef.current.apiEnabled)
        setWorkflowEnabled(externalAccessBaselineRef.current.workflowEnabled)
        setSaveError({ kind: 'generic', slice: 'externalAccess' })
        return
      }
    }

    externalAccessSaveInFlightRef.current = false
    setApiEnabled(externalAccessBaselineRef.current.apiEnabled)
    setWorkflowEnabled(externalAccessBaselineRef.current.workflowEnabled)
    await invalidateSettingsQueries()
  }

  const saveSettingsDraft = async (draft: SettingsDraft) => {
    const nextEmbeddingFingerprint = modelFingerprint(draft.embeddingModel)
    const nextRetrievalFingerprint = retrievalFingerprint({
      mode: draft.retrievalMode,
      reasoningModel: draft.reasoningModel,
      rerankModel: draft.rerankModel,
      scoreThreshold: draft.scoreThreshold,
      scoreThresholdEnabled: draft.scoreThresholdEnabled,
      topK: draft.topK,
    })
    const nextEmbeddingDirty = nextEmbeddingFingerprint !== embeddingBaselineRef.current
    const nextRetrievalDirty = nextRetrievalFingerprint !== retrievalBaselineRef.current
    const invalid =
      (nextEmbeddingDirty && !draft.embeddingModel) ||
      (nextRetrievalDirty && (!draft.reasoningModel || !draft.rerankModel)) ||
      (initialModelSetup && nextRetrievalDirty && !draft.embeddingModel) ||
      (!initialModelSetup && nextEmbeddingDirty && nextRetrievalDirty)
    if (invalid || (!nextEmbeddingDirty && !nextRetrievalDirty)) return 'skipped' as const

    const body: KnowledgeFsSettingsPayload = {
      expectedRevision: settingsRevisionRef.current,
    }
    if (nextEmbeddingDirty && draft.embeddingModel)
      body.embedding = modelPayload(draft.embeddingModel)
    if (nextRetrievalDirty && draft.reasoningModel && draft.rerankModel) {
      body.retrieval = {
        defaultMode: draft.retrievalMode,
        reasoningModel: modelPayload(draft.reasoningModel),
        rerank: {
          enabled: true,
          model: modelPayload(draft.rerankModel),
        },
        scoreThreshold: {
          enabled: draft.scoreThresholdEnabled,
          stage: draft.retrievalMode === 'research' ? 'mode-final' : 'rerank',
          value: draft.scoreThreshold,
        },
        topK: draft.topK,
      }
    }

    setSaveError(undefined)
    try {
      const result = await settingsMutation.mutateAsync({
        body,
        params: { control_space_id: space.control_space_id },
      })
      settingsRevisionRef.current = result.settings.revision
      if (result.migration) {
        migratingSettingsDraftRef.current = draft
        handledMigrationIdRef.current = undefined
        setPendingMigrationId(result.migration.id)
        return 'migration' as const
      }
      if (nextEmbeddingDirty) {
        embeddingBaselineRef.current = nextEmbeddingFingerprint
        setEmbeddingBaseline(nextEmbeddingFingerprint)
      }
      if (nextRetrievalDirty) {
        retrievalBaselineRef.current = nextRetrievalFingerprint
        setRetrievalBaseline(nextRetrievalFingerprint)
      }
      await invalidateSettingsQueries()
      return 'saved' as const
    } catch (error) {
      setSaveError({
        kind: error instanceof Response && error.status === 403 ? 'permission' : 'generic',
        slice: 'settings',
      })
      return 'failed' as const
    }
  }

  const performSettingsSave = async (draft: SettingsDraft) => {
    if (settingsSaveTimerRef.current) clearTimeout(settingsSaveTimerRef.current)

    pendingSettingsDraftRef.current = draft
    if (!canEdit) return
    if (pendingMigrationId) {
      queuedSettingsDraftRef.current = draft
      return
    }
    if (settingsSaveInFlightRef.current) {
      queuedSettingsDraftRef.current = draft
      return
    }

    settingsSaveInFlightRef.current = true
    let nextDraft: SettingsDraft | undefined = draft
    let saveResult: Awaited<ReturnType<typeof saveSettingsDraft>> = 'skipped'
    try {
      while (nextDraft) {
        queuedSettingsDraftRef.current = undefined
        saveResult = await saveSettingsDraft(nextDraft)
        if (saveResult === 'failed' || saveResult === 'migration') break
        nextDraft = queuedSettingsDraftRef.current
      }
    } finally {
      settingsSaveInFlightRef.current = false
    }

    if (saveResult === 'failed' || saveResult === 'migration') return

    const latestDraft = liveSettingsDraftRef.current
    const latestDraftIsSaved =
      modelFingerprint(latestDraft.embeddingModel) === embeddingBaselineRef.current &&
      retrievalFingerprint({
        mode: latestDraft.retrievalMode,
        reasoningModel: latestDraft.reasoningModel,
        rerankModel: latestDraft.rerankModel,
        scoreThreshold: latestDraft.scoreThreshold,
        scoreThresholdEnabled: latestDraft.scoreThresholdEnabled,
        topK: latestDraft.topK,
      }) === retrievalBaselineRef.current
    if (!latestDraftIsSaved) return

    pendingSettingsDraftRef.current = undefined
    if (settingsDraftOwnsFormLockRef.current && !basicDirtyRef.current) {
      settingsDraftOwnsFormLockRef.current = false
      onDraftFinish?.()
    }
  }
  settingsSaveRunnerRef.current = (draft) => void performSettingsSave(draft)

  useEffect(() => {
    if (pendingMigrationId || !resumeSettingsQueueAfterMigrationRef.current) return
    resumeSettingsQueueAfterMigrationRef.current = false
    const queuedDraft = queuedSettingsDraftRef.current
    queuedSettingsDraftRef.current = undefined
    if (queuedDraft) settingsSaveRunnerRef.current(queuedDraft)
  }, [pendingMigrationId])

  const scheduleSettingsSave = (draft: SettingsDraft) => {
    if (settingsSaveTimerRef.current) clearTimeout(settingsSaveTimerRef.current)
    settingsSaveTimerRef.current = setTimeout(() => void performSettingsSave(draft), 400)
  }

  useEffect(
    () => () => {
      if (settingsSaveTimerRef.current) clearTimeout(settingsSaveTimerRef.current)
    },
    [],
  )

  const requestSave = (event?: React.FormEvent<HTMLFormElement>) => {
    event?.preventDefault()
    setNameTouched(true)
    if (saveDisabled) return
    void performBasicSave()
  }

  const retrySave = () => {
    if (saveError?.slice === 'externalAccess') {
      void performExternalAccessSave(pendingExternalAccessRef.current)
      return
    }
    if (saveError?.slice === 'settings') {
      void performSettingsSave(pendingSettingsDraftRef.current ?? liveSettingsDraftRef.current)
      return
    }
    requestSave()
  }

  const armHistoryGuard = useCallback(() => {
    globalThis.history.pushState(globalThis.history.state, '', globalThis.location.href)
    historyGuardArmedRef.current = true
  }, [])

  useEffect(() => {
    if (isDirty) {
      if (
        !historyGuardArmedRef.current &&
        !browserBackPendingRef.current &&
        !allowNavigationRef.current
      )
        armHistoryGuard()
      return
    }
    if (!historyGuardArmedRef.current) return
    historyGuardReleaseRef.current = true
    historyGuardArmedRef.current = false
    globalThis.history.back()
  }, [armHistoryGuard, isDirty])

  useEffect(() => {
    const handlePopState = () => {
      if (historyGuardReleaseRef.current) {
        historyGuardReleaseRef.current = false
        return
      }
      if (allowNavigationRef.current) {
        const destination = pendingNavigationRef.current
        pendingNavigationRef.current = undefined
        if (destination) router.push(destination)
        return
      }
      if (!historyGuardArmedRef.current) return

      historyGuardArmedRef.current = false
      browserBackPendingRef.current = true
      setDiscardDialogOpen(true)
    }

    globalThis.addEventListener('popstate', handlePopState)
    return () => globalThis.removeEventListener('popstate', handlePopState)
  }, [router])

  useEffect(() => {
    if (!isDirty) return

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    const handleDocumentClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return
      const anchor = event
        .composedPath()
        .find((target): target is HTMLAnchorElement => target instanceof HTMLAnchorElement)
      if (
        !anchor ||
        anchor.hasAttribute('download') ||
        (anchor.target && anchor.target !== '_self')
      )
        return

      const destination = new URL(anchor.href, globalThis.location.href)
      const current = new URL(globalThis.location.href)
      if (
        destination.origin !== current.origin ||
        (destination.pathname === current.pathname &&
          destination.search === current.search &&
          destination.hash === current.hash)
      )
        return

      event.preventDefault()
      pendingNavigationRef.current = `${destination.pathname}${destination.search}${destination.hash}`
      setDiscardDialogOpen(true)
    }

    globalThis.addEventListener('beforeunload', handleBeforeUnload)
    document.addEventListener('click', handleDocumentClick, true)
    return () => {
      globalThis.removeEventListener('beforeunload', handleBeforeUnload)
      document.removeEventListener('click', handleDocumentClick, true)
    }
  }, [isDirty])

  const confirmDiscardAndNavigate = () => {
    const destination = pendingNavigationRef.current
    setDiscardDialogOpen(false)
    allowNavigationRef.current = true
    if (browserBackPendingRef.current) {
      browserBackPendingRef.current = false
      pendingNavigationRef.current = undefined
      globalThis.history.back()
      return
    }
    if (destination && historyGuardArmedRef.current) {
      historyGuardArmedRef.current = false
      globalThis.history.back()
      return
    }
    pendingNavigationRef.current = undefined
    if (destination) router.push(destination)
  }

  const closeDiscardDialog = () => {
    setDiscardDialogOpen(false)
    pendingNavigationRef.current = undefined
    if (!browserBackPendingRef.current) return
    browserBackPendingRef.current = false
    if (isDirty) armHistoryGuard()
  }

  const deleteKnowledge = async () => {
    if (deleteConfirmation !== initialName || deleteMutation.isPending) return
    try {
      await deleteMutation.mutateAsync({
        params: { control_space_id: space.control_space_id },
      })
      setDeleteDialogOpen(false)
      router.replace(newKnowledgeListPath)
    } catch {
      toast.error(tCommon(($) => $['api.actionFailed']))
    }
  }

  return (
    <>
      {!canEdit && (
        <div
          className="mb-3 flex items-center gap-2 rounded-lg border border-components-panel-border bg-background-section px-3 py-2 system-xs-regular text-text-tertiary"
          role="status"
        >
          <span aria-hidden className="i-ri-lock-2-line size-4 shrink-0" />
          {t(($) => $['newKnowledge.settings.viewOnly'])}
        </div>
      )}

      {settings.configuration_state !== 'pending-validation' &&
        (settings.configuration_state !== 'active' || settings.issues.length > 0) && (
          <KnowledgeModelReadinessNotice
            className="mb-3"
            description={
              settings.issues.length > 0
                ? settings.issues.map(({ field }) => readinessFieldLabel(field)).join(' · ')
                : settings.active_profile_available
                  ? t(($) => $['newKnowledge.overview.attention.modelReadiness.description'])
                  : undefined
            }
            title={
              settings.configuration_state === 'validation-failed'
                ? tCommon(($) => $['api.actionFailed'])
                : tCommon(($) => $['modelProvider.toBeConfigured'])
            }
            tone={settings.configuration_state === 'validation-failed' ? 'destructive' : 'warning'}
          />
        )}

      {saveError && (
        <div
          className="mb-3 flex items-center gap-2 rounded-lg border border-text-destructive/20 bg-background-default-subtle px-3 py-2"
          role="alert"
        >
          <span aria-hidden className="i-ri-error-warning-fill size-4 text-text-destructive" />
          <span className="min-w-0 flex-1 system-xs-regular text-text-destructive">
            {saveError.kind === 'permission'
              ? t(($) => $['newKnowledge.permissionRestricted'])
              : t(($) => $['newKnowledge.settings.saveFailed'])}
          </span>
          <Button type="button" size="small" variant="ghost" onClick={retrySave}>
            {tCommon(($) => $['operation.retry'])}
          </Button>
        </div>
      )}

      {serverConflict && (
        <div
          className="mb-3 flex items-center gap-2 rounded-lg border border-text-warning/20 bg-state-warning-hover px-3 py-2"
          role="alert"
        >
          <span aria-hidden className="i-ri-error-warning-line size-4 text-text-warning" />
          <span className="min-w-0 flex-1 system-xs-regular text-text-warning">
            {t(($) => $['newKnowledge.settings.serverConflict'])}
          </span>
        </div>
      )}

      {pendingMigrationId && (
        <div
          className="mb-3 flex items-center gap-2 rounded-lg border border-components-panel-border bg-background-section px-3 py-2 system-xs-regular text-text-tertiary"
          role="status"
        >
          <span aria-hidden className="i-ri-loader-4-line size-4 shrink-0 animate-spin" />
          {tCommon(($) => $['operation.saving'])}
        </div>
      )}

      <Form className="flex flex-col gap-4 overflow-hidden pt-2 pb-7" onSubmit={requestSave}>
        <h2 className="flex h-8 items-center system-sm-semibold text-text-secondary">
          {t(($) => $['newKnowledge.settings.basicInfo'])}
        </h2>

        <SettingsRow label={tSettings(($) => $['form.nameAndIcon'])}>
          <div className="flex items-start gap-2">
            <button
              type="button"
              aria-label={tSettings(($) => $['form.nameAndIcon'])}
              disabled={basicFieldsDisabled}
              className="shrink-0 rounded-lg outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed"
              onClick={() => setIconPickerOpen(true)}
            >
              <KnowledgeSpaceIcon background={iconBackground} icon={icon} size="small" />
            </button>
            <div className="min-w-0 flex-1">
              <Input
                aria-label={tSettings(($) => $['form.name'])}
                aria-describedby={nameTouched && nameInvalid ? NAME_ERROR_ID : undefined}
                aria-invalid={nameTouched && nameInvalid}
                autoComplete="off"
                name="knowledge-name"
                value={name}
                maxLength={KNOWLEDGE_NAME_MAX_LENGTH}
                disabled={basicFieldsDisabled}
                className={cn(nameTouched && nameInvalid && 'ring-1 ring-text-destructive')}
                onBlur={() => setNameTouched(true)}
                onChange={(event) => {
                  startDraft()
                  setName(event.target.value.slice(0, KNOWLEDGE_NAME_MAX_LENGTH))
                }}
              />
              {nameTouched && nameInvalid && (
                <p
                  id={NAME_ERROR_ID}
                  className="mt-1 system-xs-regular text-text-destructive"
                  role="alert"
                >
                  {t(($) => $['newKnowledge.settings.nameRequired'])}
                </p>
              )}
              {name.length >= KNOWLEDGE_NAME_MAX_LENGTH * 0.9 && (
                <p
                  className={cn(
                    'mt-1 text-right system-xs-medium text-text-tertiary',
                    name.length >= KNOWLEDGE_NAME_MAX_LENGTH * 0.9 && 'text-text-warning-secondary',
                  )}
                >
                  {name.length} / {KNOWLEDGE_NAME_MAX_LENGTH}
                </p>
              )}
            </div>
          </div>
        </SettingsRow>

        <SettingsRow label={tSettings(($) => $['form.desc'])}>
          <div>
            <Textarea
              aria-label={tSettings(($) => $['form.desc'])}
              aria-describedby={descriptionInvalid ? DESCRIPTION_ERROR_ID : undefined}
              aria-invalid={descriptionInvalid}
              autoComplete="off"
              name="knowledge-description"
              value={description}
              disabled={basicFieldsDisabled}
              placeholder={t(($) => $['newKnowledge.settings.descriptionPlaceholder'])}
              className={cn(
                'min-h-20 resize-none',
                descriptionInvalid && 'ring-1 ring-text-destructive',
              )}
              onValueChange={(value) => {
                startDraft()
                setDescription(value)
              }}
            />
            {descriptionInvalid && (
              <p
                id={DESCRIPTION_ERROR_ID}
                className="mt-1 system-xs-regular text-text-destructive"
                role="alert"
              >
                {tWorkflow(($) => $['chatVariable.modal.descriptionTooLong'], {
                  maxLength: KNOWLEDGE_DESCRIPTION_MAX_LENGTH,
                })}
              </p>
            )}
          </div>
        </SettingsRow>

        <SettingsRow label={tSettings(($) => $['form.permissions'])}>
          <KnowledgeSettingsMembers
            disabled={!canEdit || !canManageAccess || isBasicSaving}
            hasError={membersInvalid}
            members={members}
            ownerAccountId={space.owner_account_id}
            selectedMemberIds={selectedMemberIds}
            visibility={visibility}
            onSelectedMemberIdsChange={(memberIds) => {
              startDraft()
              setSelectedMemberIds(memberIds)
            }}
            onVisibilityChange={(nextVisibility) => {
              startDraft()
              setVisibility(nextVisibility)
            }}
          />
        </SettingsRow>

        {canEdit && (
          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              disabled={(!isDirty && !serverConflict) || isBasicSaving}
              onClick={resetDraft}
            >
              {tCommon(($) => $['operation.cancel'])}
            </Button>
            <Button type="submit" variant="primary" disabled={saveDisabled} loading={isBasicSaving}>
              {isBasicSaving
                ? tCommon(($) => $['operation.saving'])
                : t(($) => $['newKnowledge.settings.saveChanges'])}
            </Button>
          </div>
        )}

        <div className="my-1 h-px bg-divider-subtle" />

        <SettingsRow label={t(($) => $['newKnowledge.settings.apiAccessLabel'])}>
          <div className="flex min-h-7 items-center gap-2">
            <Switch
              aria-label={t(($) => $['newKnowledge.apiAgentAccess'])}
              aria-describedby={API_ACCESS_DESCRIPTION_ID}
              checked={apiEnabled}
              disabled={externalAccessDisabled}
              onCheckedChange={(checked) => {
                setApiEnabled(checked)
                void performExternalAccessSave({ apiEnabled: checked, workflowEnabled })
              }}
            />
            <p
              id={API_ACCESS_DESCRIPTION_ID}
              className="min-w-0 flex-1 system-xs-regular text-text-tertiary"
            >
              {t(($) => $['newKnowledge.settings.apiAccessDescription'])}
            </p>
          </div>
        </SettingsRow>

        <SettingsRow label={t(($) => $['newKnowledge.settings.workflowAccessLabel'])}>
          <div className="flex min-h-7 items-center gap-2">
            <Switch
              aria-label={t(($) => $['newKnowledge.workflowAccess'])}
              aria-describedby={WORKFLOW_ACCESS_DESCRIPTION_ID}
              checked={workflowEnabled}
              disabled={externalAccessDisabled}
              onCheckedChange={(checked) => {
                setWorkflowEnabled(checked)
                void performExternalAccessSave({ apiEnabled, workflowEnabled: checked })
              }}
            />
            <p
              id={WORKFLOW_ACCESS_DESCRIPTION_ID}
              className="min-w-0 flex-1 system-xs-regular text-text-tertiary"
            >
              {t(($) => $['newKnowledge.settings.workflowAccessDescription'])}
            </p>
          </div>
        </SettingsRow>

        <div className="my-1 h-px bg-divider-subtle" />

        <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:gap-1">
          <div className="w-full shrink-0 sm:w-45">
            <h2 className="flex h-8 items-center system-sm-semibold text-text-secondary">
              {t(($) => $['newKnowledge.settings.retrievalTitle'])}
            </h2>
            <p className="body-xs-regular text-text-tertiary">
              {t(($) => $['newKnowledge.settings.retrievalDescription'])}
            </p>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-3.5">
            <div>
              <div
                id={REASONING_MODEL_LABEL_ID}
                className="flex h-7 items-center system-sm-medium text-text-secondary"
              >
                {t(($) => $['newKnowledge.settings.systemReasoningModelLabel'])}
                <span aria-hidden className="ml-0.5 text-text-destructive">
                  *
                </span>
              </div>
              <ModelSelector
                ariaDescribedBy={!reasoningModel ? REASONING_MODEL_ERROR_ID : undefined}
                ariaInvalid={!reasoningModel}
                ariaLabelledBy={REASONING_MODEL_LABEL_ID}
                ariaRequired
                value={reasoningModel}
                models={reasoningModelList}
                disabled={retrievalFieldsDisabled}
                className="w-full"
                onValueChange={(model) => {
                  const draft = beginSettingsDraft({ reasoningModel: model })
                  setReasoningModel(model)
                  void performSettingsSave(draft)
                }}
              />
              {!reasoningModel && (
                <p
                  id={REASONING_MODEL_ERROR_ID}
                  className="mt-1 system-xs-regular text-text-destructive"
                >
                  {t(($) => $['newKnowledge.settings.systemReasoningModelRequired'])}
                </p>
              )}
            </div>

            <div>
              <div
                id={EMBEDDING_MODEL_LABEL_ID}
                className="flex h-7 items-center system-sm-medium text-text-secondary"
              >
                {t(($) => $['newKnowledge.settings.embeddingModelLabel'])}
                <span aria-hidden className="ml-0.5 text-text-destructive">
                  *
                </span>
              </div>
              <ModelSelector
                ariaDescribedBy={!embeddingModel ? EMBEDDING_MODEL_ERROR_ID : undefined}
                ariaInvalid={!embeddingModel}
                ariaLabelledBy={EMBEDDING_MODEL_LABEL_ID}
                ariaRequired
                value={embeddingModel}
                models={embeddingModelList}
                disabled={!canEdit || (!initialModelSetup && retrievalDirty)}
                className="w-full"
                onValueChange={(model) => {
                  if ((space.technical_summary?.document_count ?? 0) > 0) {
                    setPendingEmbeddingModel(model)
                    setEmbeddingDialogOpen(true)
                    return
                  }
                  const draft = beginSettingsDraft({ embeddingModel: model })
                  setEmbeddingModel(model)
                  void performSettingsSave(draft)
                }}
              />
              {!embeddingModel && (
                <p
                  id={EMBEDDING_MODEL_ERROR_ID}
                  className="mt-1 system-xs-regular text-text-destructive"
                >
                  {t(($) => $['newKnowledge.settings.embeddingModelRequired'])}
                </p>
              )}
              {embeddingDirty && (space.technical_summary?.document_count ?? 0) > 0 && (
                <p className="mt-1 flex items-start gap-1 system-xs-regular text-text-warning-secondary">
                  <span aria-hidden className="mt-0.5 i-ri-alert-fill size-3.5 shrink-0" />
                  {t(($) => $['newKnowledge.settings.embeddingChangeWarning'])}
                </p>
              )}
            </div>

            <div>
              <div
                id={RERANK_MODEL_LABEL_ID}
                className="flex h-7 items-center system-sm-medium text-text-secondary"
              >
                {tCommon(($) => $['modelProvider.rerankModel.key'])}
                <span aria-hidden className="ml-0.5 text-text-destructive">
                  *
                </span>
              </div>
              <ModelSelector
                ariaDescribedBy={!rerankModel ? RERANK_MODEL_ERROR_ID : undefined}
                ariaInvalid={!rerankModel}
                ariaLabelledBy={RERANK_MODEL_LABEL_ID}
                ariaRequired
                value={rerankModel}
                models={rerankModelList}
                disabled={retrievalFieldsDisabled}
                className="w-full"
                onValueChange={(model) => {
                  const draft = beginSettingsDraft({ rerankModel: model })
                  setRerankModel(model)
                  void performSettingsSave(draft)
                }}
              />
              {!rerankModel && (
                <p
                  id={RERANK_MODEL_ERROR_ID}
                  className="mt-1 system-xs-regular text-text-destructive"
                >
                  {t(($) => $['newKnowledge.settings.rerankModelRequired'])}
                </p>
              )}
            </div>

            <div>
              <label
                id="knowledge-retrieval-depth-label"
                className="flex h-7 items-center system-sm-medium text-text-secondary"
              >
                {t(($) => $['newKnowledge.settings.retrievalDepth'])}
              </label>
              <RetrievalModeSegmentedControl
                aria-labelledby="knowledge-retrieval-depth-label"
                disabled={retrievalFieldsDisabled}
                value={retrievalMode}
                onChange={(mode) => {
                  const draft = beginSettingsDraft({ retrievalMode: mode })
                  setRetrievalMode(mode)
                  void performSettingsSave(draft)
                }}
              />
            </div>

            <div className="flex flex-col gap-4 sm:flex-row">
              <div className="min-w-0 flex-1">
                <label
                  htmlFor="knowledge-top-k"
                  className="flex h-7 items-center system-sm-medium text-text-secondary"
                >
                  {t(($) => $['newKnowledge.settings.topKLabel'])}
                </label>
                <div className="flex items-center gap-3">
                  <NumberField
                    id="knowledge-top-k"
                    name="knowledge-top-k"
                    min={TOP_K_MIN}
                    max={TOP_K_MAX}
                    step={1}
                    value={topK}
                    disabled={retrievalFieldsDisabled}
                    onValueChange={(value) => {
                      const nextTopK = value ?? TOP_K_MIN
                      const draft = beginSettingsDraft({ topK: nextTopK })
                      setTopK(nextTopK)
                      scheduleSettingsSave(draft)
                    }}
                    onValueCommitted={() => void performSettingsSave(liveSettingsDraftRef.current)}
                  >
                    <NumberFieldGroup className="w-18 shrink-0">
                      <NumberFieldInput
                        aria-label={t(($) => $['newKnowledge.settings.topKLabel'])}
                        autoComplete="off"
                      />
                      <NumberFieldControls>
                        <NumberFieldIncrement />
                        <NumberFieldDecrement />
                      </NumberFieldControls>
                    </NumberFieldGroup>
                  </NumberField>
                  <Slider
                    aria-label={t(($) => $['newKnowledge.settings.topKLabel'])}
                    min={TOP_K_MIN}
                    max={TOP_K_MAX}
                    value={topK}
                    disabled={retrievalFieldsDisabled}
                    onValueChange={(value) => {
                      const draft = beginSettingsDraft({ topK: value })
                      setTopK(value)
                      scheduleSettingsSave(draft)
                    }}
                  />
                </div>
                <p className="mt-1 system-xs-regular text-text-tertiary">
                  {t(($) => $['newKnowledge.settings.topKMinimum'])}
                </p>
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex h-7 items-center gap-2">
                  <Switch
                    aria-label={tAppDebug(($) => $['datasetConfig.score_threshold'])}
                    checked={scoreThresholdEnabled}
                    disabled={retrievalFieldsDisabled || !rerankModel}
                    onCheckedChange={(checked) => {
                      const draft = beginSettingsDraft({ scoreThresholdEnabled: checked })
                      setScoreThresholdEnabled(checked)
                      void performSettingsSave(draft)
                    }}
                  />
                  <label
                    htmlFor="knowledge-score-threshold"
                    className="system-sm-medium text-text-secondary"
                  >
                    {tAppDebug(($) => $['datasetConfig.score_threshold'])}
                  </label>
                </div>
                <div className="flex items-center gap-3">
                  <NumberField
                    id="knowledge-score-threshold"
                    name="knowledge-score-threshold"
                    min={SCORE_THRESHOLD_MIN}
                    max={SCORE_THRESHOLD_MAX}
                    step={0.01}
                    value={scoreThreshold}
                    disabled={retrievalFieldsDisabled || !scoreThresholdEnabled}
                    onValueChange={(value) => {
                      const nextScoreThreshold = value ?? SCORE_THRESHOLD_MIN
                      const draft = beginSettingsDraft({ scoreThreshold: nextScoreThreshold })
                      setScoreThreshold(nextScoreThreshold)
                      scheduleSettingsSave(draft)
                    }}
                    onValueCommitted={() => void performSettingsSave(liveSettingsDraftRef.current)}
                  >
                    <NumberFieldGroup className="w-18 shrink-0">
                      <NumberFieldInput
                        aria-label={tAppDebug(($) => $['datasetConfig.score_threshold'])}
                        autoComplete="off"
                      />
                      <NumberFieldControls>
                        <NumberFieldIncrement />
                        <NumberFieldDecrement />
                      </NumberFieldControls>
                    </NumberFieldGroup>
                  </NumberField>
                  <Slider
                    aria-label={tAppDebug(($) => $['datasetConfig.score_threshold'])}
                    min={SCORE_THRESHOLD_MIN}
                    max={SCORE_THRESHOLD_MAX}
                    step={0.01}
                    value={scoreThreshold}
                    disabled={retrievalFieldsDisabled || !scoreThresholdEnabled}
                    onValueChange={(value) => {
                      const draft = beginSettingsDraft({ scoreThreshold: value })
                      setScoreThreshold(value)
                      scheduleSettingsSave(draft)
                    }}
                  />
                </div>
                <p className="mt-1 system-xs-regular text-text-tertiary">
                  {t(($) => $['newKnowledge.settings.scoreRange'])}
                </p>
              </div>
            </div>
          </div>
        </div>
      </Form>

      {canDelete && canEdit && (
        <>
          <div className="h-px bg-divider-subtle" />
          <div className="flex min-w-0 flex-col gap-4 pt-7 sm:flex-row sm:gap-1">
            <h2 className="flex h-8 w-full shrink-0 items-center system-sm-semibold text-text-destructive sm:w-45">
              {t(($) => $['newKnowledge.settings.dangerZone'])}
            </h2>
            <div className="flex min-w-0 flex-1 items-center justify-between gap-4 rounded-xl border border-components-button-destructive-secondary-border px-4 py-3">
              <div className="min-w-0">
                <p className="system-sm-medium text-text-secondary">
                  {t(($) => $['newKnowledge.settings.deleteTitle'])}
                </p>
                <p className="mt-0.5 body-xs-regular text-text-tertiary">
                  {t(($) => $['newKnowledge.settings.deleteDescription'])}
                </p>
              </div>
              <Button
                type="button"
                tone="destructive"
                disabled={isAnySavePending}
                onClick={() => setDeleteDialogOpen(true)}
              >
                {tCommon(($) => $['operation.delete'])}
              </Button>
            </div>
          </div>
        </>
      )}

      <AppIconPicker
        open={iconPickerOpen}
        enableImageUpload={false}
        initialEmoji={{ background: iconBackground, icon }}
        onOpenChange={setIconPickerOpen}
        onSelect={(selection) => {
          if (selection.type === 'emoji') {
            startDraft()
            setIcon(selection.icon)
            setIconBackground(selection.background)
          }
        }}
      />

      <AlertDialog
        open={embeddingDialogOpen}
        onOpenChange={(open) => {
          setEmbeddingDialogOpen(open)
          if (!open) setPendingEmbeddingModel(undefined)
        }}
      >
        <AlertDialogContent>
          <div className="px-6 pt-6">
            <AlertDialogTitle className="title-xl-semi-bold text-text-primary">
              {tSettings(($) => $['form.embeddingModel'])}
            </AlertDialogTitle>
            <AlertDialogDescription className="mt-2 body-sm-regular text-text-tertiary">
              {t(($) => $['newKnowledge.settings.embeddingChangeWarning'])}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton onClick={() => setPendingEmbeddingModel(undefined)}>
              {tCommon(($) => $['operation.cancel'])}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              tone="default"
              onClick={() => {
                const model = pendingEmbeddingModel
                setEmbeddingDialogOpen(false)
                setPendingEmbeddingModel(undefined)
                if (!model) return
                const draft = beginSettingsDraft({ embeddingModel: model })
                setEmbeddingModel(model)
                void performSettingsSave(draft)
              }}
            >
              {tCommon(($) => $['operation.confirm'])}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={discardDialogOpen}
        onOpenChange={(open) => {
          if (open) setDiscardDialogOpen(true)
          else closeDiscardDialog()
        }}
      >
        <AlertDialogContent>
          <div className="px-6 pt-6">
            <AlertDialogTitle className="title-xl-semi-bold text-text-primary">
              {tCommon(($) => $['operation.confirmAction'])}
            </AlertDialogTitle>
            <AlertDialogDescription className="mt-2 body-sm-regular text-text-tertiary">
              {t(($) => $['newKnowledge.discardDraftDescription'])}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton>
              {tCommon(($) => $['operation.cancel'])}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton tone="destructive" onClick={confirmDiscardAndNavigate}>
              {t(($) => $['newKnowledge.discardDraftConfirm'])}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open)
          if (!open) setDeleteConfirmation('')
        }}
      >
        <AlertDialogContent initialFocus={deleteCancelRef}>
          <div className="px-6 pt-6">
            <AlertDialogTitle className="title-xl-semi-bold text-text-primary">
              {t(($) => $['newKnowledge.settings.deleteDialogTitle'], {
                name: initialName,
              })}
            </AlertDialogTitle>
            <AlertDialogDescription className="mt-2 body-sm-regular text-text-tertiary">
              {t(($) => $['newKnowledge.settings.deleteDialogDescription'])}
            </AlertDialogDescription>
            <label
              htmlFor="knowledge-delete-confirmation"
              className="mt-5 block system-sm-medium text-text-secondary"
            >
              {t(($) => $['newKnowledge.settings.deleteConfirmPrompt'], {
                name: initialName,
              })}
            </label>
            <Input
              id="knowledge-delete-confirmation"
              autoComplete="off"
              name="knowledge-delete-confirmation"
              placeholder={initialName}
              value={deleteConfirmation}
              className="mt-2 w-full"
              onChange={(event) => setDeleteConfirmation(event.target.value)}
            />
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton ref={deleteCancelRef}>
              {tCommon(($) => $['operation.cancel'])}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              disabled={deleteConfirmation !== initialName || deleteMutation.isPending}
              loading={deleteMutation.isPending}
              onClick={() => void deleteKnowledge()}
            >
              {tCommon(($) => $['operation.delete'])}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
