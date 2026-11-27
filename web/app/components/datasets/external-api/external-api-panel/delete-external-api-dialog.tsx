import type { ExternalKnowledgeApiResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { AlertDialogHandle } from '@langgenius/dify-ui/alert-dialog'
import type { RefObject } from 'react'
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
import { Button } from '@langgenius/dify-ui/button'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'
import { useRequestErrorDescriber } from '@/service/use-request-error-message'
import { getErrorMessage } from '@/utils/error-message'

const endpoints = consoleQuery.datasets.externalKnowledgeApi

function DeleteExternalApiConfirmation({
  api,
  canManage,
  deleting,
  deleteError,
  onConfirm,
}: {
  api: ExternalKnowledgeApiResponse
  canManage: boolean
  deleting: boolean
  deleteError: string | undefined
  onConfirm: () => void
}) {
  const { t } = useTranslation(['common', 'dataset'])
  const describeRequestError = useRequestErrorDescriber()
  const usage = useQuery(
    endpoints.byExternalKnowledgeApiId.useCheck.get.queryOptions({
      input: { params: { external_knowledge_api_id: api.id } },
      // A failed check is shown inline with a retry button.
      meta: { errorToast: false },
      networkMode: 'always',
      retry: false,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
    }),
  )
  const usageCount = usage.data?.is_using ? usage.data.count : 0
  const description = usage.isError
    ? describeRequestError(
        usage.error,
        t(($) => $['api.actionFailed'], { ns: 'common' }),
      )
    : !usage.isSuccess || usage.isFetching
      ? t(($) => $.loading, { ns: 'common' })
      : usageCount > 0
        ? `${t(($) => $['deleteExternalAPIConfirmWarningContent.content.front'], { ns: 'dataset' })} ${usageCount} ${t(($) => $['deleteExternalAPIConfirmWarningContent.content.end'], { ns: 'dataset' })}`
        : t(($) => $['deleteExternalAPIConfirmWarningContent.noConnectionContent'], {
            ns: 'dataset',
          })

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>
          {`${t(($) => $['deleteExternalAPIConfirmWarningContent.title.front'], { ns: 'dataset' })} ${api.name}${t(($) => $['deleteExternalAPIConfirmWarningContent.title.end'], { ns: 'dataset' })}`}
        </AlertDialogTitle>
        <AlertDialogDescription aria-live="polite">{description}</AlertDialogDescription>
      </AlertDialogHeader>
      {(usage.isError || deleteError) && (
        <AlertDialogBody>
          {deleteError && (
            <p role="alert" className="text-text-destructive">
              {deleteError}
            </p>
          )}
          {usage.isError && (
            <Button size="small" loading={usage.isFetching} onClick={() => void usage.refetch()}>
              {t(($) => $['operation.retry'], { ns: 'common' })}
            </Button>
          )}
        </AlertDialogBody>
      )}
      <AlertDialogFooter>
        <AlertDialogCancelButton disabled={deleting}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </AlertDialogCancelButton>
        <AlertDialogConfirmButton
          disabled={!canManage || !usage.isSuccess || usage.isFetching}
          loading={deleting}
          onClick={onConfirm}
        >
          {t(($) => $['operation.confirm'], { ns: 'common' })}
        </AlertDialogConfirmButton>
      </AlertDialogFooter>
    </>
  )
}

export default function DeleteExternalApiDialog({
  handle,
  canManage,
  onOpen,
  fallbackFocus,
}: {
  handle: AlertDialogHandle<ExternalKnowledgeApiResponse>
  canManage: boolean
  onOpen: () => void
  fallbackFocus: RefObject<HTMLButtonElement | null>
}) {
  const { t } = useTranslation(['common'])
  const client = useQueryClient()
  const finalFocusRef = useRef<HTMLButtonElement>(null)
  const operation = endpoints.byExternalKnowledgeApiId.delete
  const filter = { mutationKey: operation.mutationKey(), exact: true }
  const deletion = useMutation(
    operation.mutationOptions({
      meta: { errorToast: false },
      networkMode: 'always',
      onSuccess: () => {
        finalFocusRef.current = fallbackFocus.current
        handle.close()
      },
    }),
  )
  return (
    <AlertDialog
      handle={handle}
      onOpenChange={(open, details) => {
        if (open) {
          finalFocusRef.current = null
          onOpen()
        } else if (details.reason !== 'imperative-action' && client.isMutating(filter)) {
          details.cancel()
        }
      }}
      onOpenChangeComplete={(open) => {
        if (!open) deletion.reset()
      }}
    >
      {({ payload }) =>
        payload && (
          <AlertDialogContent finalFocus={finalFocusRef}>
            <DeleteExternalApiConfirmation
              api={payload}
              canManage={canManage}
              deleting={deletion.isPending}
              deleteError={
                deletion.isError
                  ? (getErrorMessage(deletion.error) ?? t(($) => $['api.actionFailed']))
                  : undefined
              }
              onConfirm={() => {
                if (!handle.isOpen || !canManage || client.isMutating(filter)) return
                deletion.mutate({ params: { external_knowledge_api_id: payload.id } })
              }}
            />
          </AlertDialogContent>
        )
      }
    </AlertDialog>
  )
}
