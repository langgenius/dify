'use client'

import { useAtomValue } from 'jotai'
import { NuqsJotaiBridge } from 'nuqs-jotai'
import { useTranslation } from 'react-i18next'
import { KnowledgeModelReadinessBanner } from '../components/knowledge-model-readiness-banner'
import { RetrievalComposer } from './composer'
import { RetrievalHistoryPanel } from './history-panel'
import { RetrievalResultPanel } from './result-panel'
import { RetrievalRuntimeController } from './runtime-controller'
import { RetrievalStateBoundary } from './state/boundary'
import { retrievalComposerModeAtom } from './state/graph'
import { retrievalKnowledgeSpaceIdAtom, retrievalLocationQuery } from './state/inputs'

function RetrievalTestSurface() {
  const { t } = useTranslation('knowledgeSpace')
  const knowledgeSpaceId = useAtomValue(retrievalKnowledgeSpaceIdAtom)
  const mode = useAtomValue(retrievalComposerModeAtom)

  return (
    <main className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg bg-components-panel-bg px-6 pt-3 pb-5">
      <header className="shrink-0">
        <h1 className="title-xl-semi-bold leading-6 text-text-primary">
          {t(($) => $['retrievalTest.title'])}
        </h1>
        <p className="mt-1 w-full system-xs-regular text-text-tertiary">
          {t(($) => $['retrievalTest.description'])}
        </p>
      </header>
      <KnowledgeModelReadinessBanner
        capability={mode === 'deep' ? 'deep' : mode === 'research' ? 'research' : 'query'}
        className="mt-4"
        knowledgeSpaceId={knowledgeSpaceId}
      />

      <div className="mt-4 flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row">
        <section className="flex min-h-0 w-full shrink-0 flex-col pb-5 lg:w-117 lg:pr-6">
          <RetrievalComposer />
          <RetrievalHistoryPanel />
        </section>
        <RetrievalResultPanel />
      </div>
    </main>
  )
}

export function RetrievalTestPage({ knowledgeSpaceId }: { knowledgeSpaceId: string }) {
  return (
    <NuqsJotaiBridge key={`retrieval:${knowledgeSpaceId}`} config={retrievalLocationQuery}>
      <RetrievalStateBoundary knowledgeSpaceId={knowledgeSpaceId}>
        <RetrievalRuntimeController />
        <RetrievalTestSurface />
      </RetrievalStateBoundary>
    </NuqsJotaiBridge>
  )
}
