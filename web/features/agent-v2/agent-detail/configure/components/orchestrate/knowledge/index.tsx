'use client'

import type { AgentKnowledgeRetrievalItem } from '../../data'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useKnowledgeRetrievals } from '@/features/agent-v2/agent-composer/store'
import { ConfigureSectionAddButton } from '../common/add-button'
import { ConfigureSectionEmpty } from '../common/empty'
import { ConfigureSection } from '../common/section'
import { AgentKnowledgeRetrievalDialog } from './dialog'

function KnowledgeRetrievalIcon() {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-md border-[0.5px] border-divider-subtle bg-util-colors-green-green-500 p-[3px] text-text-primary-on-surface shadow-xs shadow-shadow-shadow-3">
      <span aria-hidden className="i-ri-book-open-line size-3.5" />
    </span>
  )
}

function AgentKnowledgeRetrievalRow({
  onDelete,
  onEdit,
  item,
}: {
  onDelete: () => void
  onEdit: () => void
  item: AgentKnowledgeRetrievalItem
}) {
  const { t } = useTranslation('agentV2')
  const itemName = t(item.nameKey)

  return (
    <div className="group flex min-h-8 items-center gap-1 overflow-hidden rounded-lg border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg py-1.5 pr-1.5 pl-2 shadow-xs shadow-shadow-shadow-3 focus-within:border-components-panel-border focus-within:bg-components-panel-on-panel-item-bg-hover focus-within:shadow-sm hover:border-components-panel-border hover:bg-components-panel-on-panel-item-bg-hover hover:shadow-sm">
      <div className="flex min-w-0 flex-1 items-center gap-2 py-0.5 pr-1">
        <KnowledgeRetrievalIcon />
        <span className="min-w-0 truncate system-sm-medium text-text-primary">
          {itemName}
        </span>
      </div>
      <div className="hidden shrink-0 items-center gap-1 group-focus-within:flex group-hover:flex">
        <button
          type="button"
          aria-label={t('agentDetail.configure.knowledgeRetrieval.edit', { name: itemName })}
          onClick={onEdit}
          className="flex size-6 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
        >
          <span aria-hidden className="i-ri-equalizer-2-line size-4" />
        </button>
        <button
          type="button"
          aria-label={t('agentDetail.configure.knowledgeRetrieval.remove', { name: itemName })}
          onClick={onDelete}
          className="flex size-6 items-center justify-center rounded-md text-text-tertiary hover:bg-state-destructive-hover hover:text-text-destructive focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
        >
          <span aria-hidden className="i-ri-delete-bin-line size-4" />
        </button>
      </div>
    </div>
  )
}

export function AgentKnowledgeRetrieval() {
  const { t } = useTranslation('agentV2')
  const [retrievals, setRetrievals] = useKnowledgeRetrievals()
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [editingRetrieval, setEditingRetrieval] = useState<AgentKnowledgeRetrievalItem | null>(null)
  const knowledgeRetrievalTip = t('agentDetail.configure.knowledgeRetrieval.tip')
  const retrievalListId = 'agent-configure-knowledge-retrieval-list'
  const isDialogOpen = isAddDialogOpen || !!editingRetrieval

  return (
    <>
      <ConfigureSection
        label={t('agentDetail.configure.knowledgeRetrieval.label')}
        labelId="agent-configure-knowledge-retrieval-label"
        panelId={retrievalListId}
        tip={knowledgeRetrievalTip}
        tipAriaLabel={knowledgeRetrievalTip}
        rootClassName="border-b border-divider-subtle pt-4"
        panelContentClassName="flex flex-col gap-1 pb-4"
        actions={(
          <ConfigureSectionAddButton
            ariaLabel={t('agentDetail.configure.knowledgeRetrieval.add')}
            onClick={() => {
              setEditingRetrieval(null)
              setIsAddDialogOpen(true)
            }}
          />
        )}
      >
        {retrievals.length === 0
          ? (
              <ConfigureSectionEmpty
                title={t('agentDetail.configure.knowledgeRetrieval.empty.title')}
                description={t('agentDetail.configure.knowledgeRetrieval.empty.description')}
              />
            )
          : retrievals.map(item => (
              <AgentKnowledgeRetrievalRow
                key={item.id}
                item={item}
                onDelete={() => setRetrievals(retrievals.filter(retrieval => retrieval.id !== item.id))}
                onEdit={() => setEditingRetrieval(item)}
              />
            ))}
      </ConfigureSection>
      <AgentKnowledgeRetrievalDialog
        key={editingRetrieval?.id ?? 'add'}
        initialName={editingRetrieval ? t(editingRetrieval.nameKey) : undefined}
        open={isDialogOpen}
        onOpenChange={(open) => {
          setIsAddDialogOpen(open)
          if (!open)
            setEditingRetrieval(null)
        }}
      />
    </>
  )
}
