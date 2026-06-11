'use client'

import type { I18nKeysWithPrefix } from '@/types/i18n'
import { cn } from '@langgenius/dify-ui/cn'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Infotip } from '@/app/components/base/infotip'

type AgentKnowledgeRetrievalItem = {
  id: string
  nameKey: I18nKeysWithPrefix<'agentV2', 'agentDetail.configure.knowledgeRetrieval.'>
}

const defaultRetrievals: AgentKnowledgeRetrievalItem[] = [
  {
    id: 'retrieval-1',
    nameKey: 'agentDetail.configure.knowledgeRetrieval.retrievalOne',
  },
  {
    id: 'retrieval-2',
    nameKey: 'agentDetail.configure.knowledgeRetrieval.retrievalTwo',
  },
]

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

export function AgentKnowledgeRetrieval({
  retrievals = defaultRetrievals,
}: {
  retrievals?: AgentKnowledgeRetrievalItem[]
}) {
  const { t } = useTranslation('agentV2')
  const [isExpanded, setIsExpanded] = useState(true)
  const knowledgeRetrievalTip = t('agentDetail.configure.knowledgeRetrieval.tip')
  const retrievalListId = 'agent-configure-knowledge-retrieval-list'

  return (
    <section className={cn('border-b border-divider-subtle pt-4', isExpanded && 'pb-4')} aria-labelledby="agent-configure-knowledge-retrieval-label">
      <div className="mb-2 flex min-h-6 items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-0.5">
          <h3
            id="agent-configure-knowledge-retrieval-label"
            className="truncate system-sm-semibold-uppercase text-text-secondary"
          >
            {t('agentDetail.configure.knowledgeRetrieval.label')}
          </h3>
          <Infotip aria-label={knowledgeRetrievalTip} popupClassName="max-w-64">
            {knowledgeRetrievalTip}
          </Infotip>
          <button
            type="button"
            aria-label={t('agentDetail.configure.knowledgeRetrieval.toggle')}
            aria-controls={retrievalListId}
            aria-expanded={isExpanded}
            onClick={() => setIsExpanded(expanded => !expanded)}
            className="flex size-4 shrink-0 items-center justify-center rounded-sm text-text-quaternary hover:text-text-tertiary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          >
            <span
              aria-hidden
              className={`i-custom-vender-solid-arrows-arrow-down-round-fill size-4 transition-transform ${isExpanded ? '' : '-rotate-90'}`}
            />
          </button>
        </div>

        <button
          type="button"
          aria-label={t('agentDetail.configure.knowledgeRetrieval.add')}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
        >
          <span aria-hidden className="i-ri-add-line size-4" />
        </button>
      </div>

      {isExpanded && (
        <div id={retrievalListId} className="flex flex-col gap-1">
          {retrievals.map(item => (
            <AgentKnowledgeRetrievalRow key={item.id} item={item} />
          ))}
        </div>
      )}
    </section>
  )
}
