'use client'

import type { ReactNode } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { toast } from '@langgenius/dify-ui/toast'
import { useTranslation } from 'react-i18next'
import useDocumentTitle from '@/hooks/use-document-title'

type AgentDetailLayoutProps = {
  agentId: string
  children: ReactNode
}

export function AgentDetailLayout({
  agentId,
  children,
}: AgentDetailLayoutProps) {
  const { t } = useTranslation('agentV2')

  useDocumentTitle(t('agentDetail.documentTitle'))

  const handlePublishMenuAction = () => {
    toast.success(t('api.success', { ns: 'common' }))
  }

  return (
    <main className="flex h-full min-w-0 flex-col overflow-hidden bg-components-panel-bg-blur">
      <header className="flex h-20 shrink-0 items-center justify-between border-b border-divider-subtle bg-components-panel-bg-blur px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-text-accent text-text-primary-on-surface shadow-xs">
            <span aria-hidden className="i-custom-vender-solid-mediaAndDevices-robot size-5" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate title-xl-semi-bold text-text-primary">
              {t('agentDetail.title')}
            </h1>
            <p className="mt-1 truncate system-xs-regular text-text-tertiary">
              {t('agentDetail.subtitle', { agentId })}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={(
                <Button variant="primary" className="min-w-40 gap-1.5">
                  <span aria-hidden className="i-ri-upload-cloud-2-line size-4" />
                  {t('agentDetail.publish')}
                  <span aria-hidden className="i-ri-arrow-down-s-line size-4" />
                </Button>
              )}
            />
            <DropdownMenuContent
              placement="bottom-end"
              sideOffset={6}
              popupClassName="w-[260px] p-1"
            >
              <DropdownMenuItem className="h-auto items-start gap-2 px-2 py-2" onClick={handlePublishMenuAction}>
                <span aria-hidden className="mt-0.5 i-ri-upload-cloud-2-line size-4 shrink-0 text-text-accent" />
                <span className="flex min-w-0 flex-col gap-0.5 text-left">
                  <span className="system-sm-semibold text-text-primary">
                    {t('agentDetail.publishMenu.publishUpdate')}
                  </span>
                  <span className="system-xs-regular text-text-tertiary">
                    {t('agentDetail.publishMenu.publishUpdateDescription')}
                  </span>
                </span>
              </DropdownMenuItem>
              <DropdownMenuSeparator className="mx-2 my-1" />
              <DropdownMenuItem className="h-auto items-start gap-2 px-2 py-2" onClick={handlePublishMenuAction}>
                <span aria-hidden className="mt-0.5 i-ri-user-add-line size-4 shrink-0 text-text-accent" />
                <span className="flex min-w-0 flex-col gap-0.5 text-left">
                  <span className="system-sm-semibold text-text-primary">
                    {t('agentDetail.publishMenu.saveAsNewAgent')}
                  </span>
                  <span className="system-xs-regular text-text-tertiary">
                    {t('agentDetail.publishMenu.saveAsNewAgentDescription')}
                  </span>
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button className="px-2.5" aria-label={t('agentDetail.history')}>
            <span aria-hidden className="i-ri-history-line size-4" />
          </Button>
        </div>
      </header>
      <div className="min-h-0 min-w-0 flex-1 overflow-auto">
        {children}
      </div>
    </main>
  )
}
