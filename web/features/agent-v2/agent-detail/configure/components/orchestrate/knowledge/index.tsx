'use client'

import type { AgentOrchestrateAddActionOptions } from '../add-actions-context'
import type { AgentKnowledgeRetrievalItem } from '@/features/agent-v2/agent-composer/form-state'
import { useAtom } from 'jotai'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { agentComposerKnowledgeRetrievalsAtom } from '@/features/agent-v2/agent-composer/store-modules/knowledge'
import { useRegisterAgentOrchestrateAddAction } from '../add-actions-context'
import { ConfigureSectionAddButton } from '../common/add-button'
import { ConfigureSectionConfigurableItem } from '../common/configurable-item'
import { ConfigureSectionEmpty } from '../common/empty'
import { ConfigureSection } from '../common/section'
import { AgentConfigureTipContent } from '../common/tip-content'
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
  const itemName = item.name ?? (item.nameKey ? t(item.nameKey) : item.id)

  return (
    <ConfigureSectionConfigurableItem
      icon={<KnowledgeRetrievalIcon />}
      label={itemName}
      editAriaLabel={t('agentDetail.configure.knowledgeRetrieval.edit', { name: itemName })}
      removeAriaLabel={t('agentDetail.configure.knowledgeRetrieval.remove', { name: itemName })}
      onEdit={onEdit}
      onRemove={onDelete}
    />
  )
}

export function AgentKnowledgeRetrieval() {
  const { t } = useTranslation('agentV2')
  const [retrievals, setRetrievals] = useAtom(agentComposerKnowledgeRetrievalsAtom)
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [addDialogName, setAddDialogName] = useState<string>()
  const [editingRetrieval, setEditingRetrieval] = useState<AgentKnowledgeRetrievalItem | null>(null)
  const addOptionsRef = useRef<AgentOrchestrateAddActionOptions | undefined>(undefined)
  const knowledgeRetrievalTip = t('agentDetail.configure.knowledgeRetrieval.tip')
  const retrievalListId = 'agent-configure-knowledge-retrieval-list'
  const isDialogOpen = isAddDialogOpen || !!editingRetrieval
  const updateRetrieval = (nextRetrieval: AgentKnowledgeRetrievalItem) => {
    setRetrievals(retrievals.map(retrieval => retrieval.id === nextRetrieval.id ? nextRetrieval : retrieval))
    setEditingRetrieval(nextRetrieval)
  }
  const getDefaultRetrievalName = (index: number) => {
    if (index === 1)
      return t('agentDetail.configure.knowledgeRetrieval.retrievalOne')
    if (index === 2)
      return t('agentDetail.configure.knowledgeRetrieval.retrievalTwo')

    return t('agentDetail.configure.knowledgeRetrieval.defaultName', { index })
  }
  const addRetrieval = (options?: AgentOrchestrateAddActionOptions) => {
    addOptionsRef.current = options
    setAddDialogName(getDefaultRetrievalName(retrievals.length + 1))
    setIsAddDialogOpen(true)
  }
  const createRetrieval = (nextRetrieval: AgentKnowledgeRetrievalItem) => {
    setRetrievals(current => [...current, nextRetrieval])
    setEditingRetrieval(nextRetrieval)
    setIsAddDialogOpen(false)
    addOptionsRef.current?.onAdded?.(nextRetrieval)
    addOptionsRef.current = undefined
  }
  useRegisterAgentOrchestrateAddAction('knowledge', addRetrieval)

  return (
    <>
      <ConfigureSection
        label={t('agentDetail.configure.knowledgeRetrieval.label')}
        labelId="agent-configure-knowledge-retrieval-label"
        panelId={retrievalListId}
        tip={<AgentConfigureTipContent type="knowledge" />}
        tipAriaLabel={knowledgeRetrievalTip}
        rootClassName="border-b border-divider-subtle pt-4"
        panelContentClassName="flex flex-col gap-1 pb-4"
        actions={(
          <ConfigureSectionAddButton
            ariaLabel={t('agentDetail.configure.knowledgeRetrieval.add')}
            onClick={() => addRetrieval()}
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
        item={editingRetrieval ?? undefined}
        initialName={editingRetrieval ? (editingRetrieval.name ?? (editingRetrieval.nameKey ? t(editingRetrieval.nameKey) : editingRetrieval.id)) : addDialogName}
        onItemCreate={createRetrieval}
        onItemChange={updateRetrieval}
        open={isDialogOpen}
        onOpenChange={(open) => {
          setIsAddDialogOpen(open)
          if (!open) {
            setEditingRetrieval(null)
            addOptionsRef.current = undefined
          }
        }}
      />
    </>
  )
}
