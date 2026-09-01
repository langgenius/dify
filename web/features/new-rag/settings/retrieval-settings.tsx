'use client'

import type { KnowledgeFsSettingsPayload } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { RetrievalSettingsDraft } from './model'
import type { DefaultModel } from '@/app/components/header/account-setting/model-provider-page/declarations'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
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
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { ModelSelector } from '@/app/components/header/account-setting/model-provider-page/model-selector'
import { consoleQuery } from '@/service/client'
import { KnowledgeModelReadinessNotice } from '../components/knowledge-model-readiness-notice'
import { RetrievalModeSegmentedControl } from '../components/retrieval-mode-segmented-control'
import {
  modelFingerprint,
  modelPayload,
  retrievalDraftFromSettings,
  retrievalFingerprint,
  SCORE_THRESHOLD_MAX,
  SCORE_THRESHOLD_MIN,
  TOP_K_MAX,
  TOP_K_MIN,
} from './model'
import {
  invalidateKnowledgeSettingsAtom,
  knowledgeSettingsSettingsAtom,
  knowledgeSettingsSpaceAtom,
} from './state/queries'
import {
  finishKnowledgeSettingsRetrievalDraftAtom,
  setKnowledgeSettingsSavePendingAtom,
  startKnowledgeSettingsRetrievalDraftAtom,
} from './state/workflow'

const REASONING_MODEL_LABEL_ID = 'knowledge-reasoning-model-label'
const REASONING_MODEL_ERROR_ID = 'knowledge-reasoning-model-error'
const EMBEDDING_MODEL_LABEL_ID = 'knowledge-embedding-model-label'
const EMBEDDING_MODEL_ERROR_ID = 'knowledge-embedding-model-error'
const RERANK_MODEL_LABEL_ID = 'knowledge-rerank-model-label'
const RERANK_MODEL_ERROR_ID = 'knowledge-rerank-model-error'

export function RetrievalSettingsSection() {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const { t: tSettings } = useTranslation('datasetSettings')
  const { t: tAppDebug } = useTranslation('appDebug')
  const space = useAtomValue(knowledgeSettingsSpaceAtom)
  const settings = useAtomValue(knowledgeSettingsSettingsAtom)
  const invalidateSettings = useSetAtom(invalidateKnowledgeSettingsAtom)
  const startDraftSession = useSetAtom(startKnowledgeSettingsRetrievalDraftAtom)
  const finishDraftSession = useSetAtom(finishKnowledgeSettingsRetrievalDraftAtom)
  const setSavePending = useSetAtom(setKnowledgeSettingsSavePendingAtom)
  const { data: reasoningModelList } = useModelList(ModelTypeEnum.textGeneration)
  const { data: embeddingModelList } = useModelList(ModelTypeEnum.textEmbedding)
  const { data: rerankModelList } = useModelList(ModelTypeEnum.rerank)
  const [draft, setDraft] = useState<RetrievalSettingsDraft>()
  const [pendingMigrationId, setPendingMigrationId] = useState<string>()
  const [pendingEmbeddingModel, setPendingEmbeddingModel] = useState<DefaultModel>()
  const [embeddingDialogOpen, setEmbeddingDialogOpen] = useState(false)
  const liveDraftRef = useRef<RetrievalSettingsDraft | undefined>(undefined)
  const draftSessionActiveRef = useRef(false)
  const embeddingBaselineRef = useRef<string | undefined>(undefined)
  const retrievalBaselineRef = useRef<string | undefined>(undefined)
  const settingsRevisionRef = useRef<number | undefined>(undefined)
  const queuedDraftRef = useRef<RetrievalSettingsDraft | undefined>(undefined)
  const migratingDraftRef = useRef<RetrievalSettingsDraft | undefined>(undefined)
  const activeMigrationIdRef = useRef<string | undefined>(undefined)
  const handledMigrationIdRef = useRef<string | undefined>(undefined)
  const saveInFlightRef = useRef(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
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
            control_space_id: space?.control_space_id ?? 'pending',
            migration_id: pendingMigrationId ?? 'pending',
          },
        },
      },
    ),
    enabled: Boolean(space && pendingMigrationId),
    refetchInterval: (query) =>
      query.state.data?.run_state === 'queued' || query.state.data?.run_state === 'running'
        ? 2000
        : false,
  })

  const showSaveSuccess = useCallback(
    () => toast.success(tCommon(($) => $['api.actionSuccess'])),
    [tCommon],
  )
  const showSaveError = useCallback(
    (error?: unknown) =>
      toast.error(
        error instanceof Response && error.status === 403
          ? t(($) => $['newKnowledge.permissionRestricted'])
          : t(($) => $['newKnowledge.settings.saveFailed']),
      ),
    [t],
  )

  const beginDraft = (patch: Partial<RetrievalSettingsDraft>) => {
    if (!settings) throw new Error('Knowledge settings are unavailable')
    const serverDraft = retrievalDraftFromSettings(settings)
    const current = liveDraftRef.current ?? draft ?? serverDraft
    if (!draftSessionActiveRef.current) {
      embeddingBaselineRef.current = modelFingerprint(current.embeddingModel)
      retrievalBaselineRef.current = retrievalFingerprint(current)
      if (!draft) settingsRevisionRef.current = settings.revision
      draftSessionActiveRef.current = true
      startDraftSession()
      setSavePending({ owner: 'retrieval', pending: true })
    }
    const next = { ...current, ...patch }
    liveDraftRef.current = next
    setDraft(next)
    return next
  }

  const saveDraft = async (nextDraft: RetrievalSettingsDraft) => {
    if (!space || !settings) return 'skipped' as const
    const nextEmbeddingFingerprint = modelFingerprint(nextDraft.embeddingModel)
    const nextRetrievalFingerprint = retrievalFingerprint(nextDraft)
    const embeddingBaseline =
      embeddingBaselineRef.current ??
      modelFingerprint(retrievalDraftFromSettings(settings).embeddingModel)
    const retrievalBaseline =
      retrievalBaselineRef.current ?? retrievalFingerprint(retrievalDraftFromSettings(settings))
    const embeddingDirty = nextEmbeddingFingerprint !== embeddingBaseline
    const retrievalDirty = nextRetrievalFingerprint !== retrievalBaseline
    const initialModelSetup = !settings.active_profile_available
    const invalid =
      (embeddingDirty && !nextDraft.embeddingModel) ||
      (retrievalDirty && (!nextDraft.reasoningModel || !nextDraft.rerankModel)) ||
      (initialModelSetup && retrievalDirty && !nextDraft.embeddingModel) ||
      (!initialModelSetup && embeddingDirty && retrievalDirty)
    if (invalid || (!embeddingDirty && !retrievalDirty)) return 'skipped' as const

    const body: KnowledgeFsSettingsPayload = {
      expectedRevision: settingsRevisionRef.current ?? settings.revision,
    }
    if (embeddingDirty && nextDraft.embeddingModel)
      body.embedding = modelPayload(nextDraft.embeddingModel)
    if (retrievalDirty && nextDraft.reasoningModel && nextDraft.rerankModel) {
      body.retrieval = {
        defaultMode: nextDraft.retrievalMode,
        reasoningModel: modelPayload(nextDraft.reasoningModel),
        rerank: {
          enabled: true,
          model: modelPayload(nextDraft.rerankModel),
        },
        scoreThreshold: {
          enabled: nextDraft.scoreThresholdEnabled,
          stage: nextDraft.retrievalMode === 'research' ? 'mode-final' : 'rerank',
          value: nextDraft.scoreThreshold,
        },
        topK: nextDraft.topK,
      }
    }

    try {
      const result = await settingsMutation.mutateAsync({
        body,
        params: { control_space_id: space.control_space_id },
      })
      settingsRevisionRef.current = result.settings.revision
      if (result.migration) {
        migratingDraftRef.current = nextDraft
        activeMigrationIdRef.current = result.migration.id
        handledMigrationIdRef.current = undefined
        setPendingMigrationId(result.migration.id)
        return 'migration' as const
      }
      if (embeddingDirty) embeddingBaselineRef.current = nextEmbeddingFingerprint
      if (retrievalDirty) retrievalBaselineRef.current = nextRetrievalFingerprint
      await invalidateSettings()
      return 'saved' as const
    } catch (error) {
      showSaveError(error)
      return 'failed' as const
    }
  }

  const performSave = async (nextDraft: RetrievalSettingsDraft) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    if (!space?.permission_keys.includes('knowledge_space_edit')) return
    if (activeMigrationIdRef.current || saveInFlightRef.current) {
      queuedDraftRef.current = nextDraft
      return
    }

    saveInFlightRef.current = true
    let candidate: RetrievalSettingsDraft | undefined = nextDraft
    let result: Awaited<ReturnType<typeof saveDraft>> = 'skipped'
    let didSave = false
    try {
      while (candidate) {
        queuedDraftRef.current = undefined
        result = await saveDraft(candidate)
        if (result === 'saved') didSave = true
        if (result === 'failed' || result === 'migration') break
        candidate = queuedDraftRef.current
      }
    } finally {
      saveInFlightRef.current = false
    }

    if (result === 'failed' || result === 'migration') {
      if (result === 'failed') setSavePending({ owner: 'retrieval', pending: false })
      return
    }
    const latestDraft = liveDraftRef.current
    const latestSaved =
      latestDraft &&
      modelFingerprint(latestDraft.embeddingModel) === embeddingBaselineRef.current &&
      retrievalFingerprint(latestDraft) === retrievalBaselineRef.current
    if (!latestSaved) {
      setSavePending({ owner: 'retrieval', pending: false })
      return
    }
    if (didSave) showSaveSuccess()
    liveDraftRef.current = latestDraft
    if (latestDraft) setDraft(latestDraft)
    draftSessionActiveRef.current = false
    finishDraftSession()
    setSavePending({ owner: 'retrieval', pending: false })
  }

  const scheduleSave = (nextDraft: RetrievalSettingsDraft) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => void performSave(nextDraft), 400)
  }

  useEffect(() => {
    if (!pendingMigrationId || handledMigrationIdRef.current === pendingMigrationId) return
    const migration = migrationQuery.data
    if (migration?.run_state === 'queued' || migration?.run_state === 'running') return

    if (migration?.run_state === 'succeeded') {
      handledMigrationIdRef.current = pendingMigrationId
      const savedDraft = migratingDraftRef.current
      if (savedDraft) {
        embeddingBaselineRef.current = modelFingerprint(savedDraft.embeddingModel)
        retrievalBaselineRef.current = retrievalFingerprint(savedDraft)
      }
      void invalidateSettings().then(() => {
        migratingDraftRef.current = undefined
        activeMigrationIdRef.current = undefined
        setPendingMigrationId(undefined)
        const queuedDraft = queuedDraftRef.current
        queuedDraftRef.current = undefined
        if (queuedDraft) {
          void performSave(queuedDraft)
          return
        }
        const latestDraft = liveDraftRef.current
        if (latestDraft) setDraft(latestDraft)
        draftSessionActiveRef.current = false
        finishDraftSession()
        setSavePending({ owner: 'retrieval', pending: false })
        showSaveSuccess()
      })
      return
    }

    if (
      migrationQuery.isError ||
      migration?.run_state === 'failed' ||
      migration?.run_state === 'canceled'
    ) {
      handledMigrationIdRef.current = pendingMigrationId
      migratingDraftRef.current = undefined
      activeMigrationIdRef.current = undefined
      // oxlint-disable-next-line eslint-react/set-state-in-effect -- A terminal remote migration retires the local polling session.
      setPendingMigrationId(undefined)
      setSavePending({ owner: 'retrieval', pending: false })
      showSaveError()
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- Migration completion is keyed by the observer state; queued saves use the latest ref snapshot.
  }, [
    finishDraftSession,
    invalidateSettings,
    migrationQuery.data,
    migrationQuery.isError,
    pendingMigrationId,
    setSavePending,
    showSaveError,
    showSaveSuccess,
  ])

  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    },
    [],
  )

  if (!space || !settings) return null
  const current = draft ?? retrievalDraftFromSettings(settings)
  const canEdit = space.permission_keys.includes('knowledge_space_edit')
  const initialModelSetup = !settings.active_profile_available
  const embeddingDirty = draft
    ? modelFingerprint(current.embeddingModel) !== embeddingBaselineRef.current
    : false
  const retrievalDirty = draft
    ? retrievalFingerprint(current) !== retrievalBaselineRef.current
    : false
  const retrievalFieldsDisabled = !canEdit || (!initialModelSetup && embeddingDirty)
  const readinessFieldLabel = (field: (typeof settings.issues)[number]['field']) => {
    if (field === 'embedding') return tSettings(($) => $['form.embeddingModel'])
    if (field === 'reasoning') return tCommon(($) => $['modelProvider.systemReasoningModel.key'])
    if (field === 'rerank') return tCommon(($) => $['modelProvider.rerankModel.key'])
    return t(($) => $['newKnowledge.overview.attention.modelReadiness.bindingMissing'])
  }

  return (
    <>
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

      <div className="h-px bg-divider-subtle" />
      <section className="flex min-w-0 flex-col gap-4 sm:flex-row sm:gap-1">
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
              ariaDescribedBy={!current.reasoningModel ? REASONING_MODEL_ERROR_ID : undefined}
              ariaInvalid={!current.reasoningModel}
              ariaLabelledBy={REASONING_MODEL_LABEL_ID}
              ariaRequired
              value={current.reasoningModel}
              models={reasoningModelList}
              disabled={retrievalFieldsDisabled}
              className="w-full"
              onValueChange={(reasoningModel) => {
                const next = beginDraft({ reasoningModel })
                void performSave(next)
              }}
            />
            {!current.reasoningModel && (
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
              ariaDescribedBy={!current.embeddingModel ? EMBEDDING_MODEL_ERROR_ID : undefined}
              ariaInvalid={!current.embeddingModel}
              ariaLabelledBy={EMBEDDING_MODEL_LABEL_ID}
              ariaRequired
              value={current.embeddingModel}
              models={embeddingModelList}
              disabled={!canEdit || (!initialModelSetup && retrievalDirty)}
              className="w-full"
              onValueChange={(model) => {
                if ((space.technical_summary?.document_count ?? 0) > 0) {
                  setPendingEmbeddingModel(model)
                  setEmbeddingDialogOpen(true)
                  return
                }
                const next = beginDraft({ embeddingModel: model })
                void performSave(next)
              }}
            />
            {!current.embeddingModel && (
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
              ariaDescribedBy={!current.rerankModel ? RERANK_MODEL_ERROR_ID : undefined}
              ariaInvalid={!current.rerankModel}
              ariaLabelledBy={RERANK_MODEL_LABEL_ID}
              ariaRequired
              value={current.rerankModel}
              models={rerankModelList}
              disabled={retrievalFieldsDisabled}
              className="w-full"
              onValueChange={(rerankModel) => {
                const next = beginDraft({ rerankModel })
                void performSave(next)
              }}
            />
            {!current.rerankModel && (
              <p
                id={RERANK_MODEL_ERROR_ID}
                className="mt-1 system-xs-regular text-text-destructive"
              >
                {t(($) => $['newKnowledge.settings.rerankModelRequired'])}
              </p>
            )}
          </div>

          <div>
            <div
              id="knowledge-retrieval-depth-label"
              className="flex h-7 items-center system-sm-medium text-text-secondary"
            >
              {t(($) => $['newKnowledge.settings.retrievalDepth'])}
            </div>
            <RetrievalModeSegmentedControl
              aria-labelledby="knowledge-retrieval-depth-label"
              disabled={retrievalFieldsDisabled}
              value={current.retrievalMode}
              onChange={(retrievalMode) => {
                const next = beginDraft({ retrievalMode })
                void performSave(next)
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
                  min={TOP_K_MIN}
                  max={TOP_K_MAX}
                  step={1}
                  value={current.topK}
                  disabled={retrievalFieldsDisabled}
                  onValueChange={(value) => {
                    const next = beginDraft({ topK: value ?? TOP_K_MIN })
                    scheduleSave(next)
                  }}
                  onValueCommitted={() => {
                    if (liveDraftRef.current) void performSave(liveDraftRef.current)
                  }}
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
                  value={current.topK}
                  disabled={retrievalFieldsDisabled}
                  onValueChange={(topK) => scheduleSave(beginDraft({ topK }))}
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
                  checked={current.scoreThresholdEnabled}
                  disabled={retrievalFieldsDisabled || !current.rerankModel}
                  onCheckedChange={(scoreThresholdEnabled) => {
                    const next = beginDraft({ scoreThresholdEnabled })
                    void performSave(next)
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
                  min={SCORE_THRESHOLD_MIN}
                  max={SCORE_THRESHOLD_MAX}
                  step={0.01}
                  value={current.scoreThreshold}
                  disabled={retrievalFieldsDisabled || !current.scoreThresholdEnabled}
                  onValueChange={(value) =>
                    scheduleSave(beginDraft({ scoreThreshold: value ?? SCORE_THRESHOLD_MIN }))
                  }
                  onValueCommitted={() => {
                    if (liveDraftRef.current) void performSave(liveDraftRef.current)
                  }}
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
                  value={current.scoreThreshold}
                  disabled={retrievalFieldsDisabled || !current.scoreThresholdEnabled}
                  onValueChange={(scoreThreshold) => scheduleSave(beginDraft({ scoreThreshold }))}
                />
              </div>
              <p className="mt-1 system-xs-regular text-text-tertiary">
                {t(($) => $['newKnowledge.settings.scoreRange'])}
              </p>
            </div>
          </div>
        </div>
      </section>

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
                const next = beginDraft({ embeddingModel: model })
                void performSave(next)
              }}
            >
              {tCommon(($) => $['operation.confirm'])}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
