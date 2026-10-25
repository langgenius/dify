import {
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'

export function DeleteDatasetConfirmation({
  datasetId,
  isPending,
  error,
  onConfirm,
}: {
  datasetId: string
  isPending: boolean
  error?: string
  onConfirm: () => void
}) {
  const { t } = useTranslation(['common', 'dataset'])
  const usage = useQuery(
    consoleQuery.datasets.byDatasetId.useCheck.get.queryOptions({
      input: { params: { dataset_id: datasetId } },
      staleTime: 0,
      retry: false,
      context: { silent: true },
    }),
  )

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>
          {t(($) => $.deleteDatasetConfirmTitle, { ns: 'dataset' })}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {t(($) => (usage.data?.is_using ? $.datasetUsedByApp : $.deleteDatasetConfirmContent), {
            ns: 'dataset',
          })}
        </AlertDialogDescription>
        {(error || usage.isError) && (
          <p role="alert" className="text-text-destructive">
            {error ?? t(($) => $['api.actionFailed'], { ns: 'common' })}
          </p>
        )}
        {usage.isError && (
          <Button size="small" loading={usage.isFetching} onClick={() => void usage.refetch()}>
            {t(($) => $['operation.retry'], { ns: 'common' })}
          </Button>
        )}
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancelButton disabled={isPending}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </AlertDialogCancelButton>
        <AlertDialogConfirmButton loading={isPending} onClick={onConfirm}>
          {t(($) => $['operation.confirm'], { ns: 'common' })}
        </AlertDialogConfirmButton>
      </AlertDialogFooter>
    </>
  )
}
