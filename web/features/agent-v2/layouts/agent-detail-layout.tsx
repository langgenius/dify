'use client'

import type { ReactNode } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { toast } from '@langgenius/dify-ui/toast'
import dayjs from 'dayjs'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import useDocumentTitle from '@/hooks/use-document-title'

type AgentDetailLayoutProps = {
  agentId: string
  children: ReactNode
}

type MockDraftAgentVersion = {
  id: string
  createdAt: number
  createdBy: string
  isDraft: true
  isLatest?: never
}

type MockPublishedAgentVersion = {
  id: string
  name: string
  comment: string
  createdAt: number
  createdBy: string
  isDraft?: false
  isLatest?: boolean
}

type MockAgentVersion = MockDraftAgentVersion | MockPublishedAgentVersion

const mockAgentVersions: MockAgentVersion[] = [
  {
    id: 'draft',
    createdAt: 1790467200,
    createdBy: 'Joel',
    isDraft: true,
  },
  {
    id: 'agent-version-4',
    name: 'v1.4.0 Handoff rules',
    comment: 'Aligned escalation handoff rules and response boundaries.',
    createdAt: 1790254800,
    createdBy: 'Emma Chen',
    isLatest: true,
  },
  {
    id: 'agent-version-3',
    name: 'v1.3.0 Tool routing',
    comment: 'Added mock tool preference data for scheduling and knowledge lookup.',
    createdAt: 1789648200,
    createdBy: 'Noah Kim',
  },
  {
    id: 'agent-version-2',
    name: 'v1.2.0 Prompt tuning',
    comment: 'Refined task decomposition prompts for multi-step workflows.',
    createdAt: 1789041600,
    createdBy: 'Ava Smith',
  },
  {
    id: 'agent-version-1',
    name: 'v1.0.0 Initial roster setup',
    comment: 'Created the reusable agent profile and default workflow instructions.',
    createdAt: 1788523200,
    createdBy: 'Liam Wong',
  },
]

export function AgentDetailLayout({
  agentId,
  children,
}: AgentDetailLayoutProps) {
  const { t } = useTranslation('agentV2')
  const [showVersionHistory, setShowVersionHistory] = useState(false)
  const [selectedVersionId, setSelectedVersionId] = useState(mockAgentVersions[0]!.id)

  useDocumentTitle(t('agentDetail.documentTitle'))

  const handlePublishMenuAction = () => {
    toast.success(t('api.success', { ns: 'common' }))
  }

  return (
    <main className="relative flex h-full min-w-0 flex-col overflow-hidden bg-components-panel-bg-blur">
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
          <Button
            className={cn(
              'px-2.5',
              showVersionHistory && 'bg-components-button-secondary-bg-hover',
            )}
            aria-label={t('common.versionHistory', { ns: 'workflow' })}
            onClick={() => setShowVersionHistory(true)}
          >
            <span aria-hidden className="i-ri-history-line size-4" />
          </Button>
        </div>
      </header>
      <div className="min-h-0 min-w-0 flex-1 overflow-auto">
        {children}
      </div>
      {showVersionHistory && (
        <AgentVersionHistoryPanel
          versions={mockAgentVersions}
          selectedVersionId={selectedVersionId}
          onSelectVersion={setSelectedVersionId}
          onClose={() => setShowVersionHistory(false)}
        />
      )}
    </main>
  )
}

function AgentVersionHistoryPanel({
  versions,
  selectedVersionId,
  onSelectVersion,
  onClose,
}: {
  versions: MockAgentVersion[]
  selectedVersionId: string
  onSelectVersion: (versionId: string) => void
  onClose: () => void
}) {
  const { t } = useTranslation('agentV2')

  return (
    <aside className="absolute top-20 right-0 bottom-0 flex w-[268px] flex-col rounded-l-2xl border-y-[0.5px] border-l-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xl shadow-shadow-shadow-5">
      <div className="flex items-center gap-x-2 px-4 pt-3">
        <div className="flex-1 py-1 system-xl-semibold text-text-primary">
          {t('versionHistory.title', { ns: 'workflow' })}
        </div>
        <button
          type="button"
          aria-label={t('operation.close', { ns: 'common' })}
          className="flex size-6 shrink-0 cursor-pointer items-center justify-center p-0.5"
          onClick={onClose}
        >
          <span aria-hidden className="i-ri-close-line size-4 text-text-tertiary" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {versions.map((item, index) => {
          const isSelected = item.id === selectedVersionId
          const isLast = index === versions.length - 1

          return (
            <button
              key={item.id}
              type="button"
              className={cn(
                'group relative flex w-full gap-x-1 rounded-lg p-2 text-left',
                isSelected ? 'cursor-not-allowed bg-state-accent-active' : 'cursor-pointer hover:bg-state-base-hover',
              )}
              onClick={() => onSelectVersion(item.id)}
            >
              {!isLast && <span aria-hidden className="absolute top-6 left-4 h-[calc(100%-0.75rem)] w-0.5 bg-divider-subtle" />}
              <span className="flex h-5 w-[18px] shrink-0 items-center justify-center">
                <span
                  aria-hidden
                  className={cn(
                    'size-2 rounded-lg border-2',
                    isSelected ? 'border-text-accent' : 'border-text-quaternary',
                  )}
                />
              </span>
              <span className="flex min-w-0 grow flex-col gap-y-0.5 overflow-hidden">
                <span className="mr-6 flex h-5 items-center gap-x-1">
                  <span
                    className={cn(
                      'truncate py-px system-sm-semibold',
                      isSelected ? 'text-text-accent' : 'text-text-secondary',
                    )}
                  >
                    {item.isDraft ? t('versionHistory.currentDraft', { ns: 'workflow' }) : item.name}
                  </span>
                  {item.isLatest && (
                    <span className="flex h-5 shrink-0 items-center rounded-md border border-text-accent-secondary bg-components-badge-bg-dimm px-[5px] system-2xs-medium-uppercase text-text-accent-secondary">
                      {t('versionHistory.latest', { ns: 'workflow' })}
                    </span>
                  )}
                </span>
                {!item.isDraft && (
                  <span className="system-xs-regular wrap-break-word text-text-secondary">
                    {item.comment}
                  </span>
                )}
                {!item.isDraft && (
                  <span className="truncate system-xs-regular text-text-tertiary">
                    {`${dayjs.unix(item.createdAt).format('YYYY-MM-DD HH:mm')} · ${item.createdBy}`}
                  </span>
                )}
              </span>
            </button>
          )
        })}
      </div>
    </aside>
  )
}
