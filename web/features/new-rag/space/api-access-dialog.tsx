'use client'

import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DatasetApiKeyDialogContent } from '@/app/components/api-key/dataset-api-key-dialog-content'
import { useDatasetApiKeyMutations } from '@/app/components/api-key/use-dataset-api-key-mutations'
import { CopyFeedback } from '@/app/components/base/copy-feedback'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { consoleQuery } from '@/service/console'
import { hasPermission } from '@/utils/permission'

export type KnowledgeFsApiAccessStatus = 'active' | 'inactive' | 'loading' | 'unavailable'

export function KnowledgeFsApiAccessDialog({
  status,
  knowledgeSpaceId,
  onOpenChange,
  open,
}: {
  status: KnowledgeFsApiAccessStatus
  knowledgeSpaceId: string
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  const { t } = useTranslation(['knowledgeSpace', 'dataset'])
  const { t: tAppApi } = useTranslation(['appApi'])
  const { t: tCommon } = useTranslation(['common'])
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const canManageApiKey = hasPermission(workspacePermissionKeys, 'dataset.api_key.manage')
  const [apiKeyModalOpen, setApiKeyModalOpen] = useState(false)
  const apiKeyMutations = useDatasetApiKeyMutations()
  const { data: apiBaseInfo } = useQuery(
    consoleQuery.datasets.apiBaseInfo.get.queryOptions({ context: { silent: true } }),
  )
  // The shared prefix of every KnowledgeFS service API route for this space; the operation
  // path (queries/admission, documents, sources, …) is appended by the caller.
  const endpoint = apiBaseInfo?.api_base_url
    ? `${apiBaseInfo.api_base_url.replace(/\/$/, '')}/knowledge-fs/spaces/${encodeURIComponent(knowledgeSpaceId)}`
    : ''

  const openApiKeyModal = () => {
    onOpenChange(false)
    setApiKeyModalOpen(true)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-150 overflow-hidden">
          <DialogHeader>
            <DialogTitle>{t(($) => $.apiAgentAccess)}</DialogTitle>
            <DialogDescription>{tCommon(($) => $['appMenus.apiAccessTip'])}</DialogDescription>
            <DialogHeaderCloseButton aria-label={tCommon(($) => $['operation.close'])} />
          </DialogHeader>

          <DialogBody className="space-y-4">
            <section>
              <p className="system-xs-semibold-uppercase text-text-tertiary">
                {t(($) => $['serviceApi.card.endpoint'], { ns: 'dataset' })}
              </p>
              <div className="mt-1 flex min-h-8 items-center gap-1 rounded-lg bg-components-input-bg-normal py-1 pr-1 pl-3">
                <code className="min-w-0 flex-1 truncate system-xs-medium text-text-secondary">
                  {endpoint || tAppApi(($) => $.loading)}
                </code>
                {endpoint && <CopyFeedback content={endpoint} />}
              </div>
            </section>

            {status === 'loading' ? (
              <div className="rounded-lg bg-background-section px-3 py-2 body-xs-regular text-text-tertiary">
                {tAppApi(($) => $.loading)}
              </div>
            ) : status === 'unavailable' ? (
              <div className="rounded-lg bg-background-section px-3 py-2 body-xs-regular text-text-tertiary">
                {t(($) => $.unavailable, { ns: 'dataset' })}
              </div>
            ) : status === 'inactive' ? (
              <div className="rounded-lg bg-background-section px-3 py-2 body-xs-regular text-text-tertiary">
                {t(($) => $.apiAccessInactive)}
              </div>
            ) : !canManageApiKey ? (
              <div className="rounded-lg bg-background-section px-3 py-2 body-xs-regular text-text-tertiary">
                {t(($) => $['settings.viewOnly'], { ns: 'knowledgeSpace' })}
              </div>
            ) : (
              <div className="flex justify-end">
                <Button type="button" onClick={openApiKeyModal}>
                  <span aria-hidden className="i-ri-key-2-line size-4 shrink-0" />
                  {t(($) => $['serviceApi.card.apiKey'], { ns: 'dataset' })}
                </Button>
              </div>
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>

      <Dialog
        open={apiKeyModalOpen}
        onOpenChange={(nextOpen, details) => {
          if (!nextOpen && apiKeyMutations.pending) details.cancel()
          else setApiKeyModalOpen(nextOpen)
        }}
      >
        <DatasetApiKeyDialogContent canManage={canManageApiKey} mutations={apiKeyMutations} />
      </Dialog>
    </>
  )
}
