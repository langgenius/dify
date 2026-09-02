'use client'

import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { SegmentedControl, SegmentedControlItem } from '@langgenius/dify-ui/segmented-control'
import { useAtomValue, useSetAtom } from 'jotai'
import { NuqsJotaiBridge } from 'nuqs-jotai'
import { useTranslation } from 'react-i18next'
import { KnowledgeModelReadinessBanner } from '../components/knowledge-model-readiness-banner'
import { OverviewActivity } from './overview-activity'
import { AttentionPanel } from './overview-attention'
import { InventoryPanel } from './overview-inventory'
import { OverviewMetrics, QueryOutcomesChart } from './overview-metrics'
import { FirstSourceTaskFailureBanner, OverviewOnboarding } from './overview-onboarding'
import {
  OVERVIEW_WINDOWS,
  overviewEmptyAtom,
  overviewFirstLoadFailedAtom,
  overviewKnowledgeSpaceIdAtom,
  overviewLocationQuery,
  overviewPageLoadingAtom,
  overviewShowEmptyModulesAtom,
  overviewShowIndexingAtom,
  overviewWindowAtom,
  retryOverviewSnapshotsAtom,
} from './state'
import { OverviewStateBoundary } from './state-boundary'

export function KnowledgeOverviewPage({ knowledgeSpaceId }: { knowledgeSpaceId: string }) {
  return (
    <NuqsJotaiBridge key={`overview:${knowledgeSpaceId}`} config={overviewLocationQuery}>
      <OverviewStateBoundary knowledgeSpaceId={knowledgeSpaceId}>
        <KnowledgeOverviewContent />
      </OverviewStateBoundary>
    </NuqsJotaiBridge>
  )
}

function KnowledgeOverviewContent() {
  const showEmptyModules = useAtomValue(overviewShowEmptyModulesAtom)
  const showIndexing = useAtomValue(overviewShowIndexingAtom)

  return (
    <main className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-components-panel-bg">
      <div className="w-full px-6 pt-3 pb-6">
        <OverviewHeader />
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

function OverviewHeader() {
  const { t } = useTranslation('dataset')
  const empty = useAtomValue(overviewEmptyAtom)
  const showIndexing = useAtomValue(overviewShowIndexingAtom)
  const window = useAtomValue(overviewWindowAtom)
  const setWindow = useSetAtom(overviewWindowAtom)

  return (
    <header className="relative -top-0.75 flex flex-wrap items-center justify-between gap-3">
      <h1 className="title-3xl-bold text-text-primary">
        {t(($) => $['newKnowledge.overviewTitle'])}
      </h1>
      {!empty && !showIndexing && (
        <SegmentedControl<(typeof OVERVIEW_WINDOWS)[number]>
          aria-label={t(($) => $['newKnowledge.overview.timeRange'])}
          value={window}
          onValueChange={(value) => {
            void setWindow(value)
          }}
        >
          {OVERVIEW_WINDOWS.map((value) => (
            <SegmentedControlItem<(typeof OVERVIEW_WINDOWS)[number]>
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
