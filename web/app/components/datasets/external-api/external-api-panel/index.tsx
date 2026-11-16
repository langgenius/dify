import type { ExternalKnowledgeApiResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { createDialogHandle, Dialog, DialogTrigger } from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { RiAddLine, RiBookOpenLine, RiCloseLine } from '@remixicon/react'
import { useMutation, useQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { ExternalApiDialogContent } from '@/app/components/datasets/external-api/external-api-modal/dialog-content'
import { useSaveExternalApi } from '@/app/components/datasets/external-api/external-api-modal/use-save-external-api'
import { toast } from '@/app/notifications'
import { useDocLink } from '@/context/i18n'
import { consoleQuery } from '@/service/console'
import { fetchExternalAPI } from '@/service/datasets'
import { getHttpErrorStatus } from '@/service/http-error'
import ExternalKnowledgeAPICard from '../external-knowledge-api-card'

type ExternalAPIPanelProps = {
  canManageExternalKnowledgeApi: boolean
  onClose: () => void
}

const ExternalAPIPanel: React.FC<ExternalAPIPanelProps> = ({
  canManageExternalKnowledgeApi,
  onClose,
}) => {
  const { t } = useTranslation(['common', 'dataset'])
  const docLink = useDocLink()
  const [dialog] = useState(() => createDialogHandle<ExternalKnowledgeApiResponse>())
  const details = useMutation({
    networkMode: 'always',
    mutationFn: (apiTemplateId: string) => fetchExternalAPI({ apiTemplateId }),
  })
  const save = useSaveExternalApi()
  const externalKnowledgeApiQueryOptions =
    consoleQuery.datasets.externalKnowledgeApi.get.queryOptions({ input: {} })
  const { data, isLoading } = useQuery(externalKnowledgeApiQueryOptions)
  const externalKnowledgeApiList = data?.data ?? []

  return (
    <>
      <div
        tabIndex={-1}
        className={cn('absolute inset-e-0 top-14 bottom-2 z-10 flex outline-hidden')}
      >
        <div
          className={cn(
            'relative flex h-full w-105 flex-col rounded-s-2xl border border-components-panel-border bg-components-panel-bg-alt',
          )}
        >
          <div className="flex items-start self-stretch p-4 pb-0">
            <div className="flex grow flex-col items-start gap-1">
              <div className="self-stretch system-xl-semibold text-text-primary">
                {t(($) => $.externalAPIPanelTitle, { ns: 'dataset' })}
              </div>
              <div className="self-stretch body-xs-regular text-text-tertiary">
                {t(($) => $.externalAPIPanelDescription, { ns: 'dataset' })}
              </div>
              <a
                className="flex cursor-pointer items-center justify-center gap-1 self-stretch"
                href={docLink('/use-dify/knowledge/external-knowledge-api')}
                target="_blank"
              >
                <RiBookOpenLine className="size-3 text-text-accent" />
                <div className="grow body-xs-regular text-text-accent">
                  {t(($) => $.externalAPIPanelDocumentation, { ns: 'dataset' })}
                </div>
              </a>
            </div>
            <div className="flex items-center">
              <IconButton
                aria-label={t(($) => $['operation.close'], { ns: 'common' })}
                onClick={onClose}
              >
                <RiCloseLine aria-hidden className="size-4 text-text-tertiary" />
              </IconButton>
            </div>
          </div>
          {canManageExternalKnowledgeApi && (
            <div className="flex flex-col items-start justify-center gap-2 self-stretch px-4 py-3">
              <DialogTrigger
                handle={dialog}
                render={
                  <Button
                    variant="primary"
                    className="flex items-center justify-center px-3 py-2"
                  />
                }
              >
                <RiAddLine className="size-4 text-components-button-primary-text" />
                <div className="system-sm-medium text-components-button-primary-text">
                  {t(($) => $.createExternalAPI, { ns: 'dataset' })}
                </div>
              </DialogTrigger>
            </div>
          )}
          <div className="flex grow flex-col items-start gap-1 self-stretch px-4 py-0">
            {isLoading ? (
              <LoadingPlaceholder />
            ) : (
              externalKnowledgeApiList.map((api, index) => (
                <ExternalKnowledgeAPICard
                  key={api.id}
                  api={api}
                  onEdit={() =>
                    details.mutate(api.id, {
                      onError: (error) => {
                        toast.error(
                          getHttpErrorStatus(error) && error.message
                            ? error.message
                            : t(($) => $['api.actionFailed']),
                        )
                      },
                      onSuccess: (detail) => dialog.openWithPayload(detail),
                    })
                  }
                  canManageExternalKnowledgeApi={canManageExternalKnowledgeApi}
                  position={index + 1}
                />
              ))
            )}
          </div>
        </div>
      </div>
      <Dialog
        handle={dialog}
        disablePointerDismissal
        onOpenChange={(open, event) => {
          if (open) details.reset()
          if (!open && save.isPending && event.reason !== 'imperative-action') event.cancel()
        }}
      >
        {({ payload }) => (
          <ExternalApiDialogContent
            api={payload}
            pending={save.isPending}
            onSubmit={(body) =>
              save.mutate({ id: payload?.id, body }, { onSuccess: () => dialog.close() })
            }
          />
        )}
      </Dialog>
    </>
  )
}

export default ExternalAPIPanel
