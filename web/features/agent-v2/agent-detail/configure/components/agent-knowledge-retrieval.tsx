'use client'

import type { AgentKnowledgeRetrievalItem } from './configured-data'
import { useTranslation } from 'react-i18next'
import { useAgentConfigureKnowledgeRetrievals } from '../atoms'
import { ConfigureSection } from './configure-section'
import { ConfigureSectionAddButton } from './configure-section-add-button'

function KnowledgeRetrievalIcon() {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-md border-[0.5px] border-divider-subtle bg-util-colors-green-green-500 p-[3px] text-text-primary-on-surface shadow-xs shadow-shadow-shadow-3">
      <span aria-hidden className="i-ri-book-open-line size-3.5" />
    </span>
  )
}

function AgentKnowledgeRetrievalRow({
  item,
}: {
  item: AgentKnowledgeRetrievalItem
}) {
  const { t } = useTranslation('agentV2')

  return (
    <div className="flex min-h-8 items-center gap-1 overflow-hidden rounded-lg border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg px-2 py-1.5 shadow-xs shadow-shadow-shadow-3">
      <div className="flex min-w-0 flex-1 items-center gap-2 py-0.5 pr-1">
        <KnowledgeRetrievalIcon />
        <span className="min-w-0 truncate system-sm-medium text-text-primary">
          {t(item.nameKey)}
        </span>
      </div>
    </div>
  )
}

export function AgentKnowledgeRetrieval() {
  const { t } = useTranslation('agentV2')
  const [retrievals] = useAgentConfigureKnowledgeRetrievals()
  const knowledgeRetrievalTip = t('agentDetail.configure.knowledgeRetrieval.tip')
  const retrievalListId = 'agent-configure-knowledge-retrieval-list'

  return (
    <ConfigureSection
      label={t('agentDetail.configure.knowledgeRetrieval.label')}
      labelId="agent-configure-knowledge-retrieval-label"
      panelId={retrievalListId}
      tip={knowledgeRetrievalTip}
      tipAriaLabel={knowledgeRetrievalTip}
      rootClassName="border-b border-divider-subtle pt-4"
      panelContentClassName="flex flex-col gap-1 pb-4"
      actions={(
        <ConfigureSectionAddButton ariaLabel={t('agentDetail.configure.knowledgeRetrieval.add')} />
      )}
    >
      {retrievals.map(item => (
        <AgentKnowledgeRetrievalRow key={item.id} item={item} />
      ))}
    </ConfigureSection>
  )
}
