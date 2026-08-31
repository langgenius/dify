'use client'

import { cn } from '@langgenius/dify-ui/cn'
import { Tabs, TabsPanel } from '@langgenius/dify-ui/tabs'
import { parseAsStringLiteral, useQueryState } from 'nuqs'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useKnowledgeSpacePermission } from '../knowledge-space-context'
import { BadCasesPanel } from './bad-cases-panel'
import { GoldenQuestionsPanel } from './golden-questions-panel'
import { QualityEvaluationPanel } from './quality-evaluation-panel'
import { QualityTabList } from './quality-tab-list'

type QualityTab = 'bad' | 'evaluation' | 'golden'

const qualityTabParser = parseAsStringLiteral(['bad-cases', 'evaluations'] as const).withOptions({
  history: 'replace',
})

export function QualityPage({ knowledgeSpaceId }: { knowledgeSpaceId: string }) {
  const { t } = useTranslation('dataset')
  const canEdit = useKnowledgeSpacePermission('knowledge_space_edit')
  const [queryTab, setQueryTab] = useQueryState('tab', qualityTabParser)
  const activeTab: QualityTab =
    queryTab === 'bad-cases' ? 'bad' : queryTab === 'evaluations' ? 'evaluation' : 'golden'
  const [actionSlot, setActionSlot] = useState<HTMLDivElement | null>(null)
  const [selectedEvaluationRunId, setSelectedEvaluationRunId] = useState<string>()

  const setTab = (tab: QualityTab) => {
    if (tab !== 'evaluation') setSelectedEvaluationRunId(undefined)
    void setQueryTab(tab === 'bad' ? 'bad-cases' : tab === 'evaluation' ? 'evaluations' : null)
  }

  return (
    <main
      className={cn(
        'relative min-h-full min-w-0 flex-1 px-8 pb-20',
        selectedEvaluationRunId ? 'pt-3' : 'pt-8',
      )}
    >
      {!selectedEvaluationRunId && (
        <header>
          <h1 className="system-xl-semibold text-text-primary">
            {t(($) => $['newKnowledge.qualityPage.title'])}
          </h1>
          <p className="mt-1 system-xs-regular text-text-tertiary">
            {t(($) => $['newKnowledge.qualityPage.description'])}
          </p>
        </header>
      )}

      <Tabs value={activeTab} onValueChange={(value) => setTab(value as QualityTab)}>
        {!selectedEvaluationRunId && (
          <div className="mt-2.5 flex h-14 items-end justify-between">
            <QualityTabList />
            <div ref={setActionSlot} className="flex gap-2" />
          </div>
        )}

        <TabsPanel value="golden" tabIndex={-1}>
          {activeTab === 'golden' && (
            <GoldenQuestionsPanel
              actionSlot={actionSlot}
              canEdit={canEdit}
              knowledgeSpaceId={knowledgeSpaceId}
            />
          )}
        </TabsPanel>

        <TabsPanel value="bad" tabIndex={-1}>
          {activeTab === 'bad' && (
            <BadCasesPanel canEdit={canEdit} knowledgeSpaceId={knowledgeSpaceId} />
          )}
        </TabsPanel>

        <TabsPanel value="evaluation" tabIndex={-1}>
          {activeTab === 'evaluation' && (
            <QualityEvaluationPanel
              actionSlot={actionSlot}
              canEdit={canEdit}
              knowledgeSpaceId={knowledgeSpaceId}
              selectedRunId={selectedEvaluationRunId}
              onSelectedRunIdChange={setSelectedEvaluationRunId}
            />
          )}
        </TabsPanel>
      </Tabs>
    </main>
  )
}
