'use client'

import { Tabs, TabsPanel } from '@langgenius/dify-ui/tabs'
import { parseAsString, parseAsStringLiteral, useQueryState } from 'nuqs'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BadCasesPanel } from './bad-cases-panel'
import { GoldenQuestionsPanel } from './golden-questions-panel'
import { EvaluationReport, QualityEvaluationPanel } from './quality-evaluation-panel'
import { QualityTabList } from './quality-tab-list'

type QualityTab = 'bad' | 'evaluation' | 'golden'

const qualityTabParser = parseAsStringLiteral(['bad-cases', 'evaluations'] as const).withOptions({
  history: 'replace',
})

const qualityRunParser = parseAsString.withOptions({ history: 'push' })

export function QualityPage() {
  const { t } = useTranslation('dataset')
  const [queryTab, setQueryTab] = useQueryState('tab', qualityTabParser)
  const [queryRunId, setQueryRunId] = useQueryState('run', qualityRunParser)
  const activeTab: QualityTab =
    queryTab === 'bad-cases' ? 'bad' : queryTab === 'evaluations' ? 'evaluation' : 'golden'
  const [actionSlot, setActionSlot] = useState<HTMLDivElement | null>(null)
  const selectedEvaluationRunId = activeTab === 'evaluation' ? queryRunId : null

  const setTab = (tab: QualityTab) => {
    if (tab !== 'evaluation' && queryRunId) void setQueryRunId(null)
    void setQueryTab(tab === 'bad' ? 'bad-cases' : tab === 'evaluation' ? 'evaluations' : null)
  }

  if (selectedEvaluationRunId)
    return (
      <main className="relative min-h-full min-w-0 flex-1 px-6 pt-3 pb-20">
        <EvaluationReport
          key={selectedEvaluationRunId}
          runId={selectedEvaluationRunId}
          onBack={() => void setQueryRunId(null)}
          onRunStarted={(runId) => void setQueryRunId(runId)}
        />
      </main>
    )

  return (
    <main className="relative min-h-full min-w-0 flex-1 px-6 pt-3 pb-20">
      <header>
        <h1 className="system-xl-semibold text-text-primary">
          {t(($) => $['newKnowledge.qualityPage.title'])}
        </h1>
        <p className="mt-1 system-xs-regular text-text-tertiary">
          {t(($) => $['newKnowledge.qualityPage.description'])}
        </p>
      </header>

      <Tabs value={activeTab} onValueChange={(value) => setTab(value as QualityTab)}>
        <div className="mt-2.5 flex h-14 items-end justify-between">
          <QualityTabList />
          <div ref={setActionSlot} className="flex gap-2" />
        </div>

        <TabsPanel value="golden" tabIndex={-1}>
          {activeTab === 'golden' && <GoldenQuestionsPanel actionSlot={actionSlot} />}
        </TabsPanel>

        <TabsPanel value="bad" tabIndex={-1}>
          {activeTab === 'bad' && <BadCasesPanel />}
        </TabsPanel>

        <TabsPanel value="evaluation" tabIndex={-1}>
          {activeTab === 'evaluation' && (
            <QualityEvaluationPanel
              actionSlot={actionSlot}
              onOpenReport={(runId) => void setQueryRunId(runId)}
            />
          )}
        </TabsPanel>
      </Tabs>
    </main>
  )
}
