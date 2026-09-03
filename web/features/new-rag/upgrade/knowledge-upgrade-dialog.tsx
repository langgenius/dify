'use client'

import type { KnowledgeFsUpgradeJobResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { RefObject } from 'react'
import type { DatasetCardItem } from '@/app/components/datasets/list/dataset-card/types'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { skipToken, useMutation, useQuery } from '@tanstack/react-query'
import { useRef } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { createRequestId } from '@/features/new-rag/request-id'
import { consoleQuery } from '@/service/client'

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
  const { t } = useTranslation('knowledgeSpace')
  const { t: tCommon } = useTranslation('common')
  const cancelRef = useRef<HTMLButtonElement>(null)
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
      <AlertDialogContent
        finalFocus={finalFocus}
        initialFocus={cancelRef}
        className="w-[calc(100vw-2rem)] max-w-120! overflow-hidden! rounded-2xl border-none p-0! text-left align-middle shadow-xl"
      >
        <div className="flex flex-col gap-4 p-6 pb-4">
          <AlertDialogTitle className="body-xl-medium text-text-primary">
            {t(($) => $['upgrade.dialogTitle'])}
          </AlertDialogTitle>
          <AlertDialogDescription render={<div />} className="body-md-regular text-text-primary">
            <p>
              <Trans
                i18nKey={($) => $['upgrade.dialogDescription']}
                ns="knowledgeSpace"
                components={{
                  legacy: <span className="text-text-accent" />,
                  new: <span className="text-text-accent" />,
                }}
              />
            </p>
            <ul className="mt-0 list-disc pl-5">
              <li>{t(($) => $['upgrade.dialogDuration'])}</li>
              <li>{t(($) => $['upgrade.dialogLinkedApps'])}</li>
              <li>
                <Trans
                  i18nKey={($) => $['upgrade.dialogIrreversible']}
                  ns="knowledgeSpace"
                  components={{ strong: <strong className="font-medium" /> }}
                />
              </li>
            </ul>
            {(discoveryQuery.isError || startMutation.isError) && (
              <p role="alert" className="mt-3 system-sm-regular text-text-destructive">
                {t(($) => $['upgrade.startFailed'])}
              </p>
            )}
          </AlertDialogDescription>
        </div>
        <AlertDialogActions className="gap-2 p-6 pt-0">
          <AlertDialogCancelButton ref={cancelRef} disabled={startMutation.isPending}>
            {tCommon(($) => $['operation.cancel'])}
          </AlertDialogCancelButton>
          <AlertDialogConfirmButton
            tone="default"
            loading={discoveryQuery.isFetching || startMutation.isPending}
            disabled={
              discoveryQuery.isFetching ||
              discoveryQuery.data?.can_upgrade !== true ||
              startMutation.isPending
            }
            onClick={startUpgrade}
          >
            {t(($) => $['upgrade.start'])}
          </AlertDialogConfirmButton>
        </AlertDialogActions>
      </AlertDialogContent>
    </AlertDialog>
  )
}
