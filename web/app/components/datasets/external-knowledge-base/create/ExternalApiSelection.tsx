'use client'

import type { DialogActions } from '@langgenius/dify-ui/dialog'
import { Alert, AlertActions, AlertTitle } from '@langgenius/dify-ui/alert'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogTrigger } from '@langgenius/dify-ui/dialog'
import { Input } from '@langgenius/dify-ui/input'
import { RiAddLine } from '@remixicon/react'
import { useQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useEffect, useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalApiDialogContent } from '@/app/components/datasets/external-api/external-api-modal/dialog-content'
import { useSaveExternalApi } from '@/app/components/datasets/external-api/external-api-modal/use-save-external-api'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { useOwnedQueryError } from '@/service/use-owned-query-error'
import { useRequestErrorMessage } from '@/service/use-request-error-message'
import ExternalApiSelect from './ExternalApiSelect'

type ExternalApiSelectionProps = {
  external_knowledge_api_id: string
  external_knowledge_id: string
  onChange: (data: { external_knowledge_api_id?: string; external_knowledge_id?: string }) => void
}

const ExternalApiSelection: React.FC<ExternalApiSelectionProps> = ({
  external_knowledge_api_id,
  external_knowledge_id,
  onChange,
}) => {
  const { t } = useTranslation(['dataset', 'common'])
  const router = useRouter()
  const externalKnowledgeApiQueryOptions =
    consoleQuery.datasets.externalKnowledgeApi.get.queryOptions({
      input: {},
    })
  const externalKnowledgeApiQuery = useQuery(externalKnowledgeApiQueryOptions)
  const { data } = externalKnowledgeApiQuery
  // A failed load must not offer to create the first API as if none existed.
  const externalKnowledgeApiLoad = useOwnedQueryError(externalKnowledgeApiQuery)
  const loadErrorMessage = useRequestErrorMessage(
    externalKnowledgeApiLoad?.error,
    t(($) => $.loadError, { ns: 'dataset' }),
  )
  const externalKnowledgeApiList = data?.data ?? []
  const externalKnowledgeApiLabelId = useId()
  const externalKnowledgeIdInputId = useId()
  const selectedApiId = external_knowledge_api_id || externalKnowledgeApiList[0]?.id || ''
  const actionsRef = useRef<DialogActions>(null)
  const save = useSaveExternalApi()

  const apiItems = externalKnowledgeApiList.map((api) => ({
    value: api.id,
    name: api.name,
    url: api.settings && typeof api.settings.endpoint === 'string' ? api.settings.endpoint : '',
  }))

  useEffect(() => {
    if (!external_knowledge_api_id && selectedApiId)
      onChange({ external_knowledge_api_id: selectedApiId, external_knowledge_id })
  }, [selectedApiId, external_knowledge_api_id, external_knowledge_id, onChange])

  return (
    <Dialog
      actionsRef={actionsRef}
      disablePointerDismissal
      onOpenChange={(open, details) => {
        if (!open && save.isPending && details.reason !== 'imperative-action') details.cancel()
      }}
    >
      <form className="flex flex-col gap-4 self-stretch">
        <div className="flex flex-col gap-1 self-stretch">
          <div className="flex flex-col self-stretch">
            <span
              id={externalKnowledgeApiLabelId}
              className="system-sm-semibold text-text-secondary"
            >
              {t(($) => $.externalAPIPanelTitle, { ns: 'dataset' })}
            </span>
          </div>
          {externalKnowledgeApiLoad ? (
            <Alert type="error">
              <AlertTitle>{loadErrorMessage}</AlertTitle>
              <AlertActions>
                <Button
                  type="button"
                  size="small"
                  loading={externalKnowledgeApiLoad.retrying}
                  onClick={externalKnowledgeApiLoad.retry}
                >
                  {t(($) => $['operation.retry'], { ns: 'common' })}
                </Button>
              </AlertActions>
            </Alert>
          ) : apiItems.length > 0 ? (
            <ExternalApiSelect
              aria-labelledby={externalKnowledgeApiLabelId}
              items={apiItems}
              value={selectedApiId}
              onSelect={(e) => {
                onChange({ external_knowledge_api_id: e.value, external_knowledge_id })
              }}
            />
          ) : (
            <DialogTrigger render={<Button variant="tertiary" className="justify-start" />}>
              <RiAddLine className="size-4 text-text-tertiary" />
              <span className="system-sm-regular text-text-tertiary">
                {t(($) => $.noExternalKnowledge, { ns: 'dataset' })}
              </span>
            </DialogTrigger>
          )}
        </div>
        <div className="flex flex-col gap-1 self-stretch">
          <div className="flex flex-col self-stretch">
            <label
              htmlFor={externalKnowledgeIdInputId}
              className="system-sm-semibold text-text-secondary"
            >
              {t(($) => $.externalKnowledgeId, { ns: 'dataset' })}
            </label>
          </div>
          <Input
            id={externalKnowledgeIdInputId}
            value={external_knowledge_id}
            onValueChange={(value) =>
              onChange({ external_knowledge_id: value, external_knowledge_api_id })
            }
            placeholder={t(($) => $.externalKnowledgeIdPlaceholder, { ns: 'dataset' })}
          />
        </div>
      </form>
      <ExternalApiDialogContent
        pending={save.isPending}
        onSubmit={(body) =>
          save.mutate(
            { body },
            {
              onSuccess: () => {
                actionsRef.current?.close()
                router.refresh()
              },
            },
          )
        }
      />
    </Dialog>
  )
}

export default ExternalApiSelection
