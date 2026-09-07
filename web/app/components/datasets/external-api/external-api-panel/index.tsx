import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { RiAddLine, RiBookOpenLine, RiCloseLine } from '@remixicon/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { useDocLink } from '@/context/i18n'
import { useModalContext } from '@/context/modal-context'
import { consoleQuery } from '@/service/client'
import ExternalKnowledgeAPICard from '../external-knowledge-api-card'

type ExternalAPIPanelProps = {
  canManageExternalKnowledgeApi: boolean
  onClose: () => void
}

const ExternalAPIPanel: React.FC<ExternalAPIPanelProps> = ({
  canManageExternalKnowledgeApi,
  onClose,
}) => {
  const { t } = useTranslation()
  const docLink = useDocLink()
  const { setShowExternalKnowledgeAPIModal } = useModalContext()
  const queryClient = useQueryClient()
  const externalKnowledgeApiQueryOptions =
    consoleQuery.datasets.externalKnowledgeApi.get.queryOptions({ input: {} })
  const { data, isLoading } = useQuery(externalKnowledgeApiQueryOptions)
  const externalKnowledgeApiList = data?.data ?? []

  const handleOpenExternalAPIModal = () => {
    if (!canManageExternalKnowledgeApi) return

    setShowExternalKnowledgeAPIModal({
      payload: { name: '', settings: { endpoint: '', api_key: '' } },
      datasetBindings: [],
      onSaveCallback: () => {
        void queryClient.invalidateQueries({
          queryKey: externalKnowledgeApiQueryOptions.queryKey,
        })
      },
      isEditMode: false,
    })
  }

  return (
    <div tabIndex={-1} className={cn('absolute top-14 right-0 bottom-2 z-10 flex outline-hidden')}>
      <div
        className={cn(
          'relative flex h-full w-105 flex-col rounded-l-2xl border border-components-panel-border bg-components-panel-bg-alt',
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
            <Button
              variant="primary"
              className="flex items-center justify-center px-3 py-2"
              onClick={handleOpenExternalAPIModal}
            >
              <RiAddLine className="size-4 text-components-button-primary-text" />
              <div className="system-sm-medium text-components-button-primary-text">
                {t(($) => $.createExternalAPI, { ns: 'dataset' })}
              </div>
            </Button>
          </div>
        )}
        <div className="flex grow flex-col items-start gap-1 self-stretch px-4 py-0">
          {isLoading ? (
            <Loading />
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
  )
}

export default ExternalAPIPanel
