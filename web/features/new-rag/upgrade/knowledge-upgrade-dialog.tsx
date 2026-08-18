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
import { useMutation } from '@tanstack/react-query'
import { useRef } from 'react'
import { Trans, useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const cancelRef = useRef<HTMLButtonElement>(null)
  const startMutation = useMutation({
    ...consoleQuery.datasets.byDatasetId.knowledgeFsUpgrades.post.mutationOptions(),
    onSuccess: (job) => {
      if (dataset) onStarted(dataset, job)
    },
  })

  const closeDialog = () => {
    if (startMutation.isPending) return
    startMutation.reset()
    onCancel()
  }

  const startUpgrade = () => {
    if (!dataset || startMutation.isPending) return
    startMutation.mutate({ params: { dataset_id: dataset.id } })
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
            {t(($) => $['newKnowledge.upgrade.dialogTitle'])}
          </AlertDialogTitle>
          <AlertDialogDescription render={<div />} className="body-md-regular text-text-primary">
            <p>
              <Trans
                i18nKey={($) => $['newKnowledge.upgrade.dialogDescription']}
                ns="dataset"
                components={{
                  legacy: <span className="text-text-accent" />,
                  new: <span className="text-text-accent" />,
                }}
              />
            </p>
            <ul className="mt-0 list-disc pl-5">
              <li>{t(($) => $['newKnowledge.upgrade.dialogDuration'])}</li>
              <li>{t(($) => $['newKnowledge.upgrade.dialogLinkedApps'])}</li>
              <li>
                <Trans
                  i18nKey={($) => $['newKnowledge.upgrade.dialogIrreversible']}
                  ns="dataset"
                  components={{ strong: <strong className="font-medium" /> }}
                />
              </li>
            </ul>
            {startMutation.isError && (
              <p role="alert" className="mt-3 system-sm-regular text-text-destructive">
                {t(($) => $['newKnowledge.upgrade.startFailed'])}
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
            loading={startMutation.isPending}
            disabled={startMutation.isPending}
            onClick={startUpgrade}
          >
            {t(($) => $['newKnowledge.upgrade.start'])}
          </AlertDialogConfirmButton>
        </AlertDialogActions>
      </AlertDialogContent>
    </AlertDialog>
  )
}
