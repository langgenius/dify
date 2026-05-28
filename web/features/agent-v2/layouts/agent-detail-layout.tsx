'use client'

import type { ReactNode } from 'react'
import type { VersionHistory } from '@/types/workflow'
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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import VersionHistoryItem from '@/app/components/workflow/panel/version-history-panel/version-history-item'
import { WorkflowVersion } from '@/app/components/workflow/types'
import useDocumentTitle from '@/hooks/use-document-title'

type AgentDetailLayoutProps = {
  agentId: string
  children: ReactNode
}

const createMockAgentVersion = ({
  id,
  version,
  markedName,
  markedComment,
  createdAt,
  createdBy,
}: {
  id: string
  version: string
  markedName: string
  markedComment: string
  createdAt: number
  createdBy: string
}): VersionHistory => ({
  id,
  graph: {
    nodes: [],
    edges: [],
  },
  created_at: createdAt,
  created_by: {
    id: createdBy.toLowerCase().replaceAll(' ', '-'),
    name: createdBy,
    email: '',
  },
  hash: id,
  updated_at: createdAt,
  updated_by: {
    id: createdBy.toLowerCase().replaceAll(' ', '-'),
    name: createdBy,
    email: '',
  },
  tool_published: false,
  version,
  marked_name: markedName,
  marked_comment: markedComment,
})

const mockAgentVersions: VersionHistory[] = [
  createMockAgentVersion({
    id: 'draft',
    version: WorkflowVersion.Draft,
    markedName: '',
    markedComment: '',
    createdAt: 1790467200,
    createdBy: 'Joel',
  }),
  createMockAgentVersion({
    id: 'agent-version-4',
    version: '2026-09-25T13:00:00Z',
    markedName: 'v1.4.0 Handoff rules',
    markedComment: 'Aligned escalation handoff rules and response boundaries.',
    createdAt: 1790254800,
    createdBy: 'Emma Chen',
  }),
  createMockAgentVersion({
    id: 'agent-version-3',
    version: '2026-09-18T12:30:00Z',
    markedName: 'v1.3.0 Tool routing',
    markedComment: 'Added mock tool preference data for scheduling and knowledge lookup.',
    createdAt: 1789648200,
    createdBy: 'Noah Kim',
  }),
  createMockAgentVersion({
    id: 'agent-version-2',
    version: '2026-09-11T12:00:00Z',
    markedName: 'v1.2.0 Prompt tuning',
    markedComment: 'Refined task decomposition prompts for multi-step workflows.',
    createdAt: 1789041600,
    createdBy: 'Ava Smith',
  }),
  createMockAgentVersion({
    id: 'agent-version-1',
    version: '2026-09-05T12:00:00Z',
    markedName: 'v1.0.0 Initial roster setup',
    markedComment: 'Created the reusable agent profile and default workflow instructions.',
    createdAt: 1788523200,
    createdBy: 'Liam Wong',
  }),
]

export function AgentDetailLayout({
  agentId,
  children,
}: AgentDetailLayoutProps) {
  const { t } = useTranslation('agentV2')
  const [showVersionHistory, setShowVersionHistory] = useState(false)
  const [currentVersion, setCurrentVersion] = useState<VersionHistory>(mockAgentVersions[0]!)

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
          currentVersion={currentVersion}
          onSelectVersion={setCurrentVersion}
          onClose={() => setShowVersionHistory(false)}
        />
      )}
    </main>
  )
}

function AgentVersionHistoryPanel({
  versions,
  currentVersion,
  onSelectVersion,
  onClose,
}: {
  versions: VersionHistory[]
  currentVersion: VersionHistory
  onSelectVersion: (version: VersionHistory) => void
  onClose: () => void
}) {
  const { t } = useTranslation('agentV2')
  const latestVersionId = versions.find(item => item.version !== WorkflowVersion.Draft)?.id ?? ''

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
        {versions.map((item, index) => (
          <VersionHistoryItem
            key={item.id}
            item={item}
            currentVersion={currentVersion}
            latestVersionId={latestVersionId}
            onClick={onSelectVersion}
            handleClickActionMenuItem={() => {}}
            isLast={index === versions.length - 1}
            hideActionMenu
          />
        ))}
      </div>
    </aside>
  )
}
