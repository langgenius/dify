'use client'

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
import { useQuery } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { ModelSelector } from '@/app/components/header/account-setting/model-provider-page/model-selector'
import { consoleQuery } from '@/service/console'
import { KnowledgeModelReadinessNotice } from '../components/knowledge-model-readiness-notice'
import { RetrievalModeSegmentedControl } from '../components/retrieval-mode-segmented-control'
import {
  modelFingerprint,
  retrievalDraftFromSettings,
  SCORE_THRESHOLD_MAX,
  SCORE_THRESHOLD_MIN,
  TOP_K_MAX,
  TOP_K_MIN,
} from './model'
import {
  knowledgeSettingsRetrievalDraftAtom,
  updateKnowledgeSettingsRetrievalDraftAtom,
} from './state/draft'
import { knowledgeSettingsSettingsAtom, knowledgeSettingsSpaceAtom } from './state/queries'
import { knowledgeSettingsInteractionLockedAtom } from './state/workflow'

const REASONING_MODEL_LABEL_ID = 'knowledge-reasoning-model-label'
const REASONING_MODEL_ERROR_ID = 'knowledge-reasoning-model-error'
const EMBEDDING_MODEL_LABEL_ID = 'knowledge-embedding-model-label'
const EMBEDDING_MODEL_ERROR_ID = 'knowledge-embedding-model-error'
const RERANK_MODEL_LABEL_ID = 'knowledge-rerank-model-label'
const RERANK_MODEL_ERROR_ID = 'knowledge-rerank-model-error'

export function RetrievalSettingsSection() {
  const { t } = useTranslation(['knowledgeSpace'])
  const { t: tCommon } = useTranslation(['common', 'modelProvider'])
  const { t: tSettings } = useTranslation(['datasetSettings'])
  const { t: tAppDebug } = useTranslation(['appDebug'])
  const space = useAtomValue(knowledgeSettingsSpaceAtom)
  const settings = useAtomValue(knowledgeSettingsSettingsAtom)
  const current = useAtomValue(knowledgeSettingsRetrievalDraftAtom)
  const updateDraft = useSetAtom(updateKnowledgeSettingsRetrievalDraftAtom)
  const interactionLocked = useAtomValue(knowledgeSettingsInteractionLockedAtom)
  const { data: reasoningModelList = [] } = useQuery(
    consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryOptions({
      input: { params: { model_type: ModelTypeEnum.textGeneration } },
      select: (response) => response.data,
    }),
  )
  const { data: embeddingModelList = [] } = useQuery(
    consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryOptions({
      input: { params: { model_type: ModelTypeEnum.textEmbedding } },
      select: (response) => response.data,
    }),
  )
  const { data: rerankModelList = [] } = useQuery(
    consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryOptions({
      input: { params: { model_type: ModelTypeEnum.rerank } },
      select: (response) => response.data,
    }),
  )
  const [pendingEmbeddingModel, setPendingEmbeddingModel] = useState<DefaultModel>()
  const [embeddingDialogOpen, setEmbeddingDialogOpen] = useState(false)

  if (!space || !settings || !current) return null
  const canEdit = space.permission_keys.includes('knowledge_space_edit') && !interactionLocked
  const embeddingDirty =
    modelFingerprint(current.embeddingModel) !==
    modelFingerprint(retrievalDraftFromSettings(settings).embeddingModel)
  const retrievalFieldsDisabled = !canEdit
  const updateRetrievalDraft = (patch: Partial<RetrievalSettingsDraft>) => {
    if (canEdit) updateDraft(patch)
  }
  const readinessFieldLabel = (field: (typeof settings.issues)[number]['field']) => {
    if (field === 'embedding') return tSettings(($) => $['form.embeddingModel'])
    if (field === 'reasoning')
      return tCommon(($) => $['modelProvider.systemReasoningModel.key'], { ns: 'modelProvider' })
    if (field === 'rerank')
      return tCommon(($) => $['modelProvider.rerankModel.key'], { ns: 'modelProvider' })
    return t(($) => $['overview.attention.modelReadiness.bindingMissing'])
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
                  ? t(($) => $['overview.attention.modelReadiness.description'])
                  : undefined
            }
            title={
              settings.configuration_state === 'validation-failed'
                ? tCommon(($) => $['api.actionFailed'])
                : tCommon(($) => $['modelProvider.toBeConfigured'], { ns: 'modelProvider' })
            }
            tone={settings.configuration_state === 'validation-failed' ? 'destructive' : 'warning'}
          />
        )}

      <div className="h-px bg-divider-subtle" />
      <section className="flex min-w-0 flex-col gap-4 sm:flex-row sm:gap-1">
        <div className="w-full shrink-0 sm:w-45">
          <h2 className="flex h-8 items-center system-sm-semibold text-text-secondary">
            {t(($) => $['settings.retrievalTitle'])}
          </h2>
          <p className="body-xs-regular text-text-tertiary">
            {t(($) => $['settings.retrievalDescription'])}
          </p>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3.5">
          <div>
            <div
              id={REASONING_MODEL_LABEL_ID}
              className="flex h-7 items-center system-sm-medium text-text-secondary"
            >
              {t(($) => $['settings.systemReasoningModelLabel'])}
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
              onValueChange={(reasoningModel) => updateRetrievalDraft({ reasoningModel })}
            />
            {!current.reasoningModel && (
              <p
                id={REASONING_MODEL_ERROR_ID}
                className="mt-1 system-xs-regular text-text-destructive"
              >
                {t(($) => $['settings.systemReasoningModelRequired'])}
              </p>
            )}
          </div>

          <div>
            <div
              id={EMBEDDING_MODEL_LABEL_ID}
              className="flex h-7 items-center system-sm-medium text-text-secondary"
            >
              {t(($) => $['settings.embeddingModelLabel'])}
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
              disabled={!canEdit}
              className="w-full"
              onValueChange={(model) => {
                if (!canEdit) return
                if (modelFingerprint(model) === modelFingerprint(current.embeddingModel)) return
                if ((space.technical_summary?.document_count ?? 0) > 0) {
                  setPendingEmbeddingModel(model)
                  setEmbeddingDialogOpen(true)
                  return
                }
                updateRetrievalDraft({ embeddingModel: model })
              }}
            />
            {!current.embeddingModel && (
              <p
                id={EMBEDDING_MODEL_ERROR_ID}
                className="mt-1 system-xs-regular text-text-destructive"
              >
                {t(($) => $['settings.embeddingModelRequired'])}
              </p>
            )}
            {embeddingDirty && (space.technical_summary?.document_count ?? 0) > 0 && (
              <p className="mt-1 flex items-start gap-1 system-xs-regular text-text-warning-secondary">
                <span aria-hidden className="mt-0.5 i-ri-alert-fill size-3.5 shrink-0" />
                {t(($) => $['settings.embeddingChangeWarning'])}
              </p>
            )}
          </div>

          <div>
            <div
              id={RERANK_MODEL_LABEL_ID}
              className="flex h-7 items-center system-sm-medium text-text-secondary"
            >
              {tCommon(($) => $['modelProvider.rerankModel.key'], { ns: 'modelProvider' })}
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
              onValueChange={(rerankModel) => updateRetrievalDraft({ rerankModel })}
            />
            {!current.rerankModel && (
              <p
                id={RERANK_MODEL_ERROR_ID}
                className="mt-1 system-xs-regular text-text-destructive"
              >
                {t(($) => $['settings.rerankModelRequired'])}
              </p>
            )}
          </div>

          <div>
            <div
              id="knowledge-retrieval-depth-label"
              className="flex h-7 items-center system-sm-medium text-text-secondary"
            >
              {t(($) => $['settings.retrievalDepth'])}
            </div>
            <RetrievalModeSegmentedControl
              aria-labelledby="knowledge-retrieval-depth-label"
              disabled={retrievalFieldsDisabled}
              value={current.retrievalMode}
              onChange={(retrievalMode) => updateRetrievalDraft({ retrievalMode })}
            />
          </div>

          <div className="flex flex-col gap-4 sm:flex-row">
            <div className="min-w-0 flex-1">
              <label
                htmlFor="knowledge-top-k"
                className="flex h-7 items-center system-sm-medium text-text-secondary"
              >
                {t(($) => $['settings.topKLabel'])}
              </label>
              <div className="flex items-center gap-3">
                <NumberField
                  id="knowledge-top-k"
                  min={TOP_K_MIN}
                  max={TOP_K_MAX}
                  step={1}
                  value={current.topK}
                  disabled={retrievalFieldsDisabled}
                  onValueChange={(value) => updateRetrievalDraft({ topK: value ?? TOP_K_MIN })}
                >
                  <NumberFieldGroup className="w-18 shrink-0">
                    <NumberFieldInput
                      aria-label={t(($) => $['settings.topKLabel'])}
                      autoComplete="off"
                    />
                    <NumberFieldControls>
                      <NumberFieldIncrement />
                      <NumberFieldDecrement />
                    </NumberFieldControls>
                  </NumberFieldGroup>
                </NumberField>
                <Slider
                  aria-label={t(($) => $['settings.topKLabel'])}
                  min={TOP_K_MIN}
                  max={TOP_K_MAX}
                  value={current.topK}
                  disabled={retrievalFieldsDisabled}
                  onValueChange={(topK) => updateRetrievalDraft({ topK })}
                />
              </div>
              <p className="mt-1 system-xs-regular text-text-tertiary">
                {t(($) => $['settings.topKMinimum'])}
              </p>
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex h-7 items-center gap-2">
                <Switch
                  aria-label={tAppDebug(($) => $['datasetConfig.score_threshold'])}
                  checked={current.scoreThresholdEnabled}
                  disabled={retrievalFieldsDisabled || !current.rerankModel}
                  onCheckedChange={(scoreThresholdEnabled) => {
                    if (current.rerankModel) updateRetrievalDraft({ scoreThresholdEnabled })
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
                  onValueChange={(value) => {
                    if (current.scoreThresholdEnabled)
                      updateRetrievalDraft({ scoreThreshold: value ?? SCORE_THRESHOLD_MIN })
                  }}
                >
                  <NumberFieldGroup className="w-20 shrink-0">
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
                  onValueChange={(scoreThreshold) => {
                    if (current.scoreThresholdEnabled) updateRetrievalDraft({ scoreThreshold })
                  }}
                />
              </div>
              <p className="mt-1 system-xs-regular text-text-tertiary">
                {t(($) => $['settings.scoreRange'])}
              </p>
            </div>
          </div>
        </div>
      </section>

      <AlertDialog
        open={embeddingDialogOpen && canEdit}
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
              {t(($) => $['settings.embeddingChangeWarning'])}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton
              type="button"
              onClick={() => setPendingEmbeddingModel(undefined)}
            >
              {tCommon(($) => $['operation.cancel'])}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              type="button"
              tone="default"
              disabled={!canEdit}
              onClick={() => {
                const model = pendingEmbeddingModel
                setEmbeddingDialogOpen(false)
                setPendingEmbeddingModel(undefined)
                if (!model) return
                updateRetrievalDraft({ embeddingModel: model })
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
