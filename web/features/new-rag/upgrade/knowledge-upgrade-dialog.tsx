'use client'

import type { KnowledgeFsUpgradeJobResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { RefObject } from 'react'
import type { DatasetCardItem } from '@/app/components/datasets/list/dataset-card/types'
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { isDefinedError } from '@orpc/client'
import { skipToken, useMutation, useQuery } from '@tanstack/react-query'
import { useId, useRef } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useDocLink } from '@/context/i18n'
import { ModelCostNotice } from '@/features/new-rag/components/model-cost-notice'
import { CreationModelField } from '@/features/new-rag/create/model-settings'
import { createRequestId } from '@/features/new-rag/request-id'
import { consoleQuery } from '@/service/console'
import {
  UPGRADE_MODEL_KEYS,
  upgradeModelsFingerprint,
  useUpgradeModels,
} from './use-upgrade-models'

export function KnowledgeUpgradeDialog({
  dataset,
  finalFocus,
  onCancel,
  onStarted,
}: {
  dataset?: DatasetCardItem
  finalFocus?: RefObject<HTMLElement | null>
  onCancel: () => void
  onStarted: (dataset: DatasetCardItem, job: KnowledgeFsUpgradeJobResponse) => void
}) {
  const { t } = useTranslation(['knowledgeUpgrade', 'knowledgeSpace'])
  const { t: tCommon } = useTranslation(['common'])
  const { t: tModels } = useTranslation(['knowledgeSettings', 'modelProvider', 'knowledgeCreate'])
  const docLink = useDocLink()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const modelCostNoticeId = useId()
  // Network retries of the same model choice reuse the key; any model change starts a new intent.
  const idempotencyKeyRef = useRef<{ fingerprint: string; key: string } | undefined>(undefined)
  const modelSettingsLabelId = useId()
  const discoveryQuery = useQuery(
    consoleQuery.datasets.byDatasetId.knowledgeFsUpgrades.get.queryOptions({
      input: dataset ? { params: { dataset_id: dataset.id } } : skipToken,
    }),
  )
  const canUpgrade = discoveryQuery.data?.can_upgrade === true
  const models = useUpgradeModels({
    datasetId: dataset?.id,
    recommendations: canUpgrade ? discoveryQuery.data?.models : undefined,
  })
  const startMutation = useMutation({
    ...consoleQuery.datasets.byDatasetId.knowledgeFsUpgrades.post.mutationOptions(),
    onSuccess: (job) => {
      idempotencyKeyRef.current = undefined
      if (dataset) onStarted(dataset, job)
    },
    onError: (error, { body }) => {
      if (!isDefinedError(error) || error.code !== 'knowledge_fs_upgrade_models_unavailable') return
      if (body.models) models.reject(body.models, error.data.details?.issues ?? [])
      void models.refresh()
    },
  })
  const modelsRejected =
    isDefinedError(startMutation.error) &&
    startMutation.error.code === 'knowledge_fs_upgrade_models_unavailable'

  const closeDialog = () => {
    if (startMutation.isPending) return
    startMutation.reset()
    models.reset()
    idempotencyKeyRef.current = undefined
    onCancel()
  }

  const startUpgrade = () => {
    if (
      !dataset ||
      discoveryQuery.isFetching ||
      !canUpgrade ||
      !models.payload ||
      startMutation.isPending
    )
      return
    const fingerprint = `${dataset.id}|${upgradeModelsFingerprint(models.payload)}`
    if (idempotencyKeyRef.current?.fingerprint !== fingerprint)
      idempotencyKeyRef.current = { fingerprint, key: createRequestId() }
    startMutation.mutate({
      body: { models: models.payload },
      headers: { 'Idempotency-Key': idempotencyKeyRef.current.key },
      params: { dataset_id: dataset.id },
    })
  }
  const modelLabels = {
    embedding: tModels(($) => $['settings.embeddingModelLabel'], { ns: 'knowledgeSettings' }),
    rerank: tModels(($) => $['modelProvider.rerankModel.key'], { ns: 'modelProvider' }),
    reasoning: tModels(($) => $['settings.systemReasoningModelLabel'], {
      ns: 'knowledgeSettings',
    }),
  }
  const modelRequiredMessages = {
    embedding: tModels(($) => $['settings.embeddingModelRequired'], { ns: 'knowledgeSettings' }),
    rerank: tModels(($) => $['settings.rerankModelRequired'], { ns: 'knowledgeSettings' }),
    reasoning: tModels(($) => $['settings.systemReasoningModelRequired'], {
      ns: 'knowledgeSettings',
    }),
  }

  return (
    <AlertDialog
      open={Boolean(dataset)}
      onOpenChange={(open) => {
        if (!open) closeDialog()
      }}
    >
      <AlertDialogContent finalFocus={finalFocus} initialFocus={cancelRef}>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t(($) => $['upgrade.dialogTitle'], { ns: 'knowledgeUpgrade' })}
          </AlertDialogTitle>
          <AlertDialogDescription render={<div />}>
            <p>
              <Trans
                i18nKey={($) => $['upgrade.dialogDescription']}
                ns="knowledgeUpgrade"
                components={{
                  legacy: <span className="text-text-accent" />,
                  new: <span className="text-text-accent" />,
                }}
              />
            </p>
            {dataset && (
              <ModelCostNotice
                id={modelCostNoticeId}
                className="my-3"
                summary={t(($) => $['upgrade.summary'], {
                  ns: 'knowledgeUpgrade',
                  name: dataset.name,
                })}
                description={t(($) => $['upgrade.modelCostDescription'], {
                  ns: 'knowledgeUpgrade',
                })}
              />
            )}
            <ul className="mt-0 list-disc ps-5">
              <li>{t(($) => $['upgrade.dialogDuration'], { ns: 'knowledgeUpgrade' })}</li>
              <li>{t(($) => $['upgrade.dialogLinkedApps'], { ns: 'knowledgeUpgrade' })}</li>
              <li>
                <Trans
                  i18nKey={($) => $['upgrade.dialogAvailability']}
                  ns="knowledgeUpgrade"
                  components={{ strong: <strong className="font-medium" /> }}
                />
              </li>
            </ul>
            <a
              href={docLink('/cloud/use-dify/knowledge-base/upgrade-from-classic')}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block text-text-accent underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-state-accent-solid"
            >
              {t(($) => $.learnMore, { ns: 'knowledgeSpace' })}
            </a>
            {(discoveryQuery.isError || startMutation.isError) && (
              <p role="alert" className="mt-3 system-sm-regular text-text-destructive">
                {modelsRejected
                  ? t(($) => $['upgrade.modelsUnavailable'], { ns: 'knowledgeUpgrade' })
                  : t(($) => $['upgrade.startFailed'], { ns: 'knowledgeUpgrade' })}
              </p>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {canUpgrade && (
          <AlertDialogBody>
            <section
              aria-labelledby={modelSettingsLabelId}
              className="flex flex-col gap-3 border-t border-divider-subtle pt-4"
            >
              <h3 id={modelSettingsLabelId} className="system-sm-semibold text-text-primary">
                {tModels(($) => $.modelSettings, { ns: 'knowledgeCreate' })}
              </h3>
              {UPGRADE_MODEL_KEYS.map((key) => (
                <CreationModelField
                  key={key}
                  inline
                  field={models.fields[key]}
                  label={modelLabels[key]}
                  requiredMessage={modelRequiredMessages[key]}
                  disabled={startMutation.isPending}
                  onChange={() => {
                    if (modelsRejected) startMutation.reset()
                  }}
                />
              ))}
            </section>
          </AlertDialogBody>
        )}
        <AlertDialogFooter>
          <AlertDialogCancelButton ref={cancelRef} disabled={startMutation.isPending}>
            {tCommon(($) => $['operation.cancel'])}
          </AlertDialogCancelButton>
          <AlertDialogConfirmButton
            tone="default"
            aria-describedby={modelCostNoticeId}
            loading={discoveryQuery.isFetching || startMutation.isPending}
            disabled={!canUpgrade || !models.payload}
            onClick={startUpgrade}
          >
            {t(($) => $['upgrade.start'], { ns: 'knowledgeUpgrade' })}
          </AlertDialogConfirmButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
