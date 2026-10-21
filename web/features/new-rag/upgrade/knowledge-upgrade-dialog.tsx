'use client'

import type { KnowledgeFsUpgradeJobResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { RefObject } from 'react'
import type { DatasetCardItem } from '@/app/components/datasets/list/dataset-card/types'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { skipToken, useMutation, useQuery } from '@tanstack/react-query'
import { useId, useRef } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useDocLink } from '@/context/i18n'
import { ModelCostNotice } from '@/features/new-rag/components/model-cost-notice'
import { createRequestId } from '@/features/new-rag/request-id'
import { consoleQuery } from '@/service/console'

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
  const docLink = useDocLink()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const modelCostNoticeId = useId()
  const idempotencyKeyRef = useRef<string | undefined>(undefined)
  const discoveryQuery = useQuery(
    consoleQuery.datasets.byDatasetId.knowledgeFsUpgrades.get.queryOptions({
      input: dataset ? { params: { dataset_id: dataset.id } } : skipToken,
    }),
  )
  const startMutation = useMutation({
    ...consoleQuery.datasets.byDatasetId.knowledgeFsUpgrades.post.mutationOptions(),
    onSuccess: (job) => {
      idempotencyKeyRef.current = undefined
      if (dataset) onStarted(dataset, job)
    },
  })

  const closeDialog = () => {
    if (startMutation.isPending) return
    startMutation.reset()
    idempotencyKeyRef.current = undefined
    onCancel()
  }

  const startUpgrade = () => {
    if (
      !dataset ||
      discoveryQuery.isFetching ||
      discoveryQuery.data?.can_upgrade !== true ||
      startMutation.isPending
    )
      return
    idempotencyKeyRef.current ??= createRequestId()
    startMutation.mutate({
      headers: { 'Idempotency-Key': idempotencyKeyRef.current },
      params: { dataset_id: dataset.id },
    })
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
            <ul className="mt-0 list-disc pl-5">
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
              href={docLink(
                // @ts-expect-error Cloud-only page not yet in the generated doc paths.
                '/cloud/use-dify/knowledge-base/upgrade-from-classic',
              )}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block text-text-accent underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-state-accent-solid"
            >
              {t(($) => $.learnMore, { ns: 'knowledgeSpace' })}
            </a>
            {(discoveryQuery.isError || startMutation.isError) && (
              <p role="alert" className="mt-3 system-sm-regular text-text-destructive">
                {t(($) => $['upgrade.startFailed'], { ns: 'knowledgeUpgrade' })}
              </p>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancelButton ref={cancelRef} disabled={startMutation.isPending}>
            {tCommon(($) => $['operation.cancel'])}
          </AlertDialogCancelButton>
          <AlertDialogConfirmButton
            tone="default"
            aria-describedby={modelCostNoticeId}
            loading={discoveryQuery.isFetching || startMutation.isPending}
            disabled={discoveryQuery.data?.can_upgrade !== true}
            onClick={startUpgrade}
          >
            {t(($) => $['upgrade.start'], { ns: 'knowledgeUpgrade' })}
          </AlertDialogConfirmButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
