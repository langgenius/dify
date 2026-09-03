'use client'

import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@langgenius/dify-ui/dialog'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiKeyModal } from '@/app/components/api-key/api-key-modal'
import { CopyFeedback } from '@/app/components/base/copy-feedback'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { consoleQuery } from '@/service/client'
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
  const { t } = useTranslation('knowledgeSpace')
  const { t: tAppApi } = useTranslation('appApi')
  const { t: tCommon } = useTranslation('common')
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const canManageApiKey = hasPermission(workspacePermissionKeys, 'dataset.api_key.manage')
  const [apiKeyModalOpen, setApiKeyModalOpen] = useState(false)
  const { data: apiBaseInfo } = useQuery(
    consoleQuery.datasets.apiBaseInfo.get.queryOptions({ context: { silent: true } }),
  )
  const endpoint = apiBaseInfo?.api_base_url
    ? `${apiBaseInfo.api_base_url.replace(/\/$/, '')}/knowledge-fs/spaces/${encodeURIComponent(knowledgeSpaceId)}/queries/admission`
    : ''

  const openApiKeyModal = () => {
    onOpenChange(false)
    setApiKeyModalOpen(true)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-150! max-w-[calc(100vw-2rem)]! flex-col overflow-hidden! rounded-2xl! p-0!">
          <header className="flex shrink-0 items-start justify-between gap-4 px-6 pt-6 pb-4">
            <div>
              <DialogTitle className="title-2xl-semi-bold text-text-primary">
                {t(($) => $.apiAgentAccess)}
              </DialogTitle>
              <DialogDescription className="mt-1 body-xs-regular text-text-tertiary">
                {tCommon(($) => $['appMenus.apiAccessTip'])}
              </DialogDescription>
            </div>
            <Button
              type="button"
              variant="ghost"
              aria-label={tCommon(($) => $['operation.close'])}
              className="size-8 shrink-0 px-0"
              onClick={() => onOpenChange(false)}
            >
              <span aria-hidden className="i-ri-close-line size-4" />
            </Button>
          </header>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 pb-6">
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
                {t(($) => $['settings.viewOnly'])}
              </div>
            ) : (
              <div className="flex justify-end">
                <Button type="button" onClick={openApiKeyModal}>
                  <span aria-hidden className="i-ri-key-2-line size-4 shrink-0" />
                  {t(($) => $['serviceApi.card.apiKey'], { ns: 'dataset' })}
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ApiKeyModal
        open={apiKeyModalOpen}
        canManage={canManageApiKey}
        scope={{ type: 'dataset' }}
        onOpenChange={setApiKeyModalOpen}
      />
    </>
  )
}
