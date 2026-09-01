'use client'

import type { OverviewWindow } from './state'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { SegmentedControl, SegmentedControlItem } from '@langgenius/dify-ui/segmented-control'
import { useAtomValue, useSetAtom } from 'jotai'
import { parseAsStringLiteral, useQueryState } from 'nuqs'
import { useTranslation } from 'react-i18next'
import { KnowledgeModelReadinessBanner } from '../components/knowledge-model-readiness-banner'
import { OverviewActivity } from './overview-activity'
import { AttentionPanel } from './overview-attention'
import { InventoryPanel } from './overview-inventory'
import { OverviewMetrics, QueryOutcomesChart } from './overview-metrics'
import { FirstSourceTaskFailureBanner, OverviewOnboarding } from './overview-onboarding'
import {
  overviewEmptyAtom,
  overviewFirstLoadFailedAtom,
  overviewKnowledgeSpaceIdAtom,
  overviewPageLoadingAtom,
  overviewShowEmptyModulesAtom,
  overviewShowIndexingAtom,
  overviewWindowAtom,
  retryOverviewSnapshotsAtom,
} from './state'
import { OverviewStateBoundary } from './state-boundary'

const WINDOWS: OverviewWindow[] = ['24h', '7d', '30d']
const overviewWindowParser = parseAsStringLiteral(WINDOWS)
  .withDefault('24h')
  .withOptions({ history: 'push' })

export function KnowledgeOverviewPage({ knowledgeSpaceId }: { knowledgeSpaceId: string }) {
  const [window, setWindow] = useQueryState('window', overviewWindowParser)

  return (
    <OverviewStateBoundary knowledgeSpaceId={knowledgeSpaceId} window={window}>
      <KnowledgeOverviewContent window={window} onWindowChange={(value) => void setWindow(value)} />
    </OverviewStateBoundary>
  )
}

function KnowledgeOverviewContent({
  onWindowChange,
  window,
}: {
  onWindowChange: (window: OverviewWindow) => void
  window: OverviewWindow
}) {
  const showEmptyModules = useAtomValue(overviewShowEmptyModulesAtom)
  const showIndexing = useAtomValue(overviewShowIndexingAtom)

  return (
    <main className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-components-panel-bg">
      <div className="w-full px-6 pt-3 pb-6">
        <OverviewHeader window={window} onWindowChange={onWindowChange} />
        <FirstSourceTaskFailureBanner />
        <OverviewKnowledgeModelReadinessBanner />
        <OverviewRecoveryStatus />
        <OverviewOnboarding />
        <div className={cn('mt-3', showEmptyModules && 'pt-6')}>
          <OverviewMetrics />
        </div>
        <div
          className={cn(
            'grid lg:grid-cols-2',
            showIndexing ? 'mt-3 gap-2.5' : showEmptyModules ? 'mt-2 gap-2.5' : 'mt-3 gap-2.5',
          )}
        >
          <AttentionPanel />
          <QueryOutcomesChart />
        </div>
        <OverviewActivity />
        <div className="mt-3">
          <InventoryPanel />
        </div>
      </div>
    </main>
  )
}

function OverviewHeader({
  onWindowChange,
  window,
}: {
  onWindowChange: (window: OverviewWindow) => void
  window: OverviewWindow
}) {
  const { t } = useTranslation('dataset')
  const empty = useAtomValue(overviewEmptyAtom)
  const showIndexing = useAtomValue(overviewShowIndexingAtom)
  const setGraphWindow = useSetAtom(overviewWindowAtom)

  return (
    <header className="relative -top-0.75 flex flex-wrap items-center justify-between gap-3">
      <h1 className="title-3xl-bold text-text-primary">
        {t(($) => $['newKnowledge.overviewTitle'])}
      </h1>
      {!empty && !showIndexing && (
        <SegmentedControl<OverviewWindow>
          aria-label={t(($) => $['newKnowledge.overview.timeRange'])}
          value={window}
          onValueChange={(value) => {
            setGraphWindow(value)
            onWindowChange(value)
          }}
        >
          {WINDOWS.map((value) => (
            <SegmentedControlItem<OverviewWindow>
              key={value}
              className="h-6.5 px-2.5"
              value={value}
            >
              {value === '24h'
                ? value
                : value === '7d'
                  ? t(($) => $['newKnowledge.overview.sevenDays'])
                  : t(($) => $['newKnowledge.overview.thirtyDays'])}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
      )}
    </header>
  )
}

function OverviewKnowledgeModelReadinessBanner() {
  const knowledgeSpaceId = useAtomValue(overviewKnowledgeSpaceIdAtom)
  return (
    <KnowledgeModelReadinessBanner
      capability="query"
      className="mt-4"
      knowledgeSpaceId={knowledgeSpaceId}
    />
  )
}

function OverviewRecoveryStatus() {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const pageLoading = useAtomValue(overviewPageLoadingAtom)
  const firstLoadFailed = useAtomValue(overviewFirstLoadFailedAtom)
  const retry = useSetAtom(retryOverviewSnapshotsAtom)

  return (
    <>
      {pageLoading && (
        <p className="sr-only" role="status">
          {tCommon(($) => $.loading)}
        </p>
      )}
      {firstLoadFailed && (
        <div
          role="alert"
          className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-divider-regular bg-background-section p-4"
        >
          <p className="system-sm-regular text-text-destructive">
            {t(($) => $['newKnowledge.detailErrorDescription'])}
          </p>
          <Button size="small" variant="secondary" onClick={retry}>
            {tCommon(($) => $['operation.retry'])}
          </Button>
        </div>
      )}
    </>
  )
}
