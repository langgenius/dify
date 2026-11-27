import type { RefObject } from 'react'
import { Alert, AlertActions, AlertTitle } from '@langgenius/dify-ui/alert'
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
  createAlertDialogHandle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { selectPipelineTemplateList } from '@/app/components/rag-pipeline/utils/query-select'
import { consoleQuery } from '@/service/console'
import { useOwnedQueryError } from '@/service/use-owned-query-error'
import { useRequestErrorMessage } from '@/service/use-request-error-message'
import { getErrorMessage } from '@/utils/error-message'
import TemplateCard from './template-card'

const templates = consoleQuery.rag.pipeline.templates.get
const deleteTemplate = consoleQuery.rag.pipeline.customized.templates.byTemplateId.delete
const listInput = { query: { type: 'customized' } } as const
const listKey = templates.queryOptions({ input: listInput }).queryKey

const CustomizedList = ({
  fallbackFocusRef,
}: {
  fallbackFocusRef: RefObject<HTMLElement | null>
}) => {
  const { t } = useTranslation(['common', 'dataset', 'datasetPipeline'])
  const queryClient = useQueryClient()
  const [deleteDialog] = useState(() => createAlertDialogHandle<string>())
  const listQuery = useQuery(
    templates.queryOptions({
      input: listInput,
      select: selectPipelineTemplateList,
    }),
  )
  const { data } = listQuery
  const list = data?.pipeline_templates ?? []
  const listLoad = useOwnedQueryError(listQuery)
  const loadErrorMessage = useRequestErrorMessage(
    listLoad?.error,
    t(($) => $.loadError, { ns: 'dataset' }),
  )
  const instanceId = useId()
  const mutationKey = [...deleteTemplate.mutationKey(), instanceId]
  const deleteFilter = { mutationKey, exact: true }
  const deletion = useMutation({
    ...deleteTemplate.mutationOptions({
      meta: { errorToast: false },
      networkMode: 'always',
      onSuccess: () => {
        deleteDialog.close()
      },
    }),
    mutationKey,
  })

  return (
    <>
      {listLoad && (
        <>
          <div className="pt-2 system-sm-semibold-uppercase text-text-tertiary">
            {t(($) => $['templates.customized'], { ns: 'datasetPipeline' })}
          </div>
          <Alert type="error" className="my-2">
            <AlertTitle>{loadErrorMessage}</AlertTitle>
            <AlertActions>
              <Button size="small" loading={listLoad.retrying} onClick={listLoad.retry}>
                {t(($) => $['operation.retry'], { ns: 'common' })}
              </Button>
            </AlertActions>
          </Alert>
        </>
      )}
      {list.length > 0 && (
        <>
          <div className="pt-2 system-sm-semibold-uppercase text-text-tertiary">
            {t(($) => $['templates.customized'], { ns: 'datasetPipeline' })}
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(296px,1fr))] gap-3 py-2">
            {list.map((pipeline) => (
              <TemplateCard
                key={pipeline.id}
                type="customized"
                pipeline={pipeline}
                onDelete={(id) => deleteDialog.openWithPayload(id)}
              />
            ))}
          </div>
        </>
      )}
      <AlertDialog
        handle={deleteDialog}
        onOpenChange={(open, details) => {
          if (open) deletion.reset()
          else if (details.reason !== 'imperative-action' && queryClient.isMutating(deleteFilter))
            details.cancel()
        }}
      >
        {({ payload: id }) => {
          const targetExists = list.some((template) => template.id === id)
          const targetStillExists = () =>
            queryClient
              .getQueryData(listKey)
              ?.pipeline_templates.some((template) => template.id === id)
          return (
            <AlertDialogContent
              finalFocus={() => (targetStillExists() ? true : fallbackFocusRef.current)}
            >
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t(($) => $['deletePipeline.title'], { ns: 'datasetPipeline' })}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {t(($) => $['deletePipeline.content'], { ns: 'datasetPipeline' })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              {deletion.isError && (
                <AlertDialogBody>
                  <p role="alert" className="text-text-destructive">
                    {getErrorMessage(deletion.error) ?? t(($) => $['api.actionFailed'])}
                  </p>
                </AlertDialogBody>
              )}
              <AlertDialogFooter>
                <AlertDialogCancelButton disabled={deletion.isPending}>
                  {t(($) => $['operation.cancel'])}
                </AlertDialogCancelButton>
                <AlertDialogConfirmButton
                  disabled={!targetExists}
                  loading={deletion.isPending}
                  onClick={() => {
                    if (
                      !id ||
                      !targetStillExists() ||
                      !deleteDialog.isOpen ||
                      queryClient.isMutating(deleteFilter)
                    )
                      return
                    deletion.mutate({ params: { template_id: id } })
                  }}
                >
                  {t(($) => $['operation.confirm'])}
                </AlertDialogConfirmButton>
              </AlertDialogFooter>
            </AlertDialogContent>
          )
        }}
      </AlertDialog>
    </>
  )
}

export default CustomizedList
