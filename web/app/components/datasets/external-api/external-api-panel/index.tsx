import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  createDialogHandle,
  Dialog,
  DialogContent,
  DialogTrigger,
} from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { RiAddLine, RiBookOpenLine, RiCloseLine } from '@remixicon/react'
import { useQuery } from '@tanstack/react-query'
import dynamic from 'next/dynamic'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { useSaveExternalApi } from '@/app/components/datasets/external-api/external-api-modal/use-save-external-api'
import { useDocLink } from '@/context/i18n'
import { consoleQuery } from '@/service/console'
import ExternalKnowledgeAPICard from '../external-knowledge-api-card'

const ExternalApiEditor = dynamic(
  () => import('@/app/components/datasets/external-api/external-api-modal'),
  { ssr: false },
)

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
  const [dialog] = useState(() => createDialogHandle())
  const save = useSaveExternalApi()
  const externalKnowledgeApiQueryOptions =
    consoleQuery.datasets.externalKnowledgeApi.get.queryOptions({ input: {} })
  const { data, isLoading } = useQuery(externalKnowledgeApiQueryOptions)
  const externalKnowledgeApiList = data?.data ?? []

  return (
    <Dialog
      handle={dialog}
      disablePointerDismissal
      onOpenChange={(open, details) => {
        if (!open && save.isPending && details.reason !== 'imperative-action') details.cancel()
      }}
    >
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
                onClick={() => onClose()}
              >
                <RiCloseLine aria-hidden className="size-4 text-text-tertiary" />
              </IconButton>
            </div>
          </div>
          {canManageExternalKnowledgeApi && (
            <div className="flex flex-col items-start justify-center gap-2 self-stretch px-4 py-3">
              <DialogTrigger
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
                  canManageExternalKnowledgeApi={canManageExternalKnowledgeApi}
                  position={index + 1}
                />
              ))
            )}
          </div>
        </div>
      </div>
      <DialogContent>
        <ExternalApiEditor
          pending={save.isPending}
          onSubmit={(values) =>
            save.mutate(values, {
              onSuccess: () => {
                dialog.close()
              },
            })
          }
        />
      </DialogContent>
    </Dialog>
  )
}

export default ExternalAPIPanel
