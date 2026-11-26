'use client'

import type { EvaluationResourceType } from './types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import UpgradeBtn from '@/app/components/billing/upgrade-btn'
import BlockIcon from '@/app/components/workflow/block-icon'
import { BlockEnum } from '@/app/components/workflow/types'
import FixedMetricItem from './components/fixed-metric-item'
import {
  buildMetricOption,
  getMetricVisual,
  getToneClasses,
} from './components/metric-selector/utils'
import SectionHeader, { InlineSectionHeader } from './components/section-header'
import { getTranslatedMetricDescription } from './default-metric-descriptions'

// Sample configuration shown to workspaces whose plan excludes Evaluation. Every Evaluation
// API rejects those workspaces, so the preview renders fixed data and calls none of them.
const SAMPLE_NODE_METRICS: Array<{ metricId: string; nodeType: BlockEnum }> = [
  { metricId: 'faithfulness', nodeType: BlockEnum.LLM },
  { metricId: 'answer_relevancy', nodeType: BlockEnum.LLM },
  { metricId: 'context_precision', nodeType: BlockEnum.KnowledgeRetrieval },
]

const SAMPLE_FIXED_METRICS: Record<
  'agents' | 'datasets',
  Array<{ metricId: string; selected: boolean }>
> = {
  datasets: [
    { metricId: 'context_precision', selected: true },
    { metricId: 'context_recall', selected: true },
    { metricId: 'context_relevance', selected: false },
  ],
  agents: [
    { metricId: 'task_completion', selected: true },
    { metricId: 'trajectory_quality', selected: true },
    { metricId: 'tool_selection_correctness', selected: false },
  ],
}

const SAMPLE_CONDITION: Record<EvaluationResourceType, { metricId: string; value: string }> = {
  apps: { metricId: 'faithfulness', value: '0.8' },
  snippets: { metricId: 'faithfulness', value: '0.8' },
  datasets: { metricId: 'context_precision', value: '0.7' },
  agents: { metricId: 'task_completion', value: '0.8' },
}

const NODE_TITLE_KEYS = {
  [BlockEnum.LLM]: 'blocks.llm',
  [BlockEnum.KnowledgeRetrieval]: 'blocks.knowledge-retrieval',
} as const

const SampleField = ({ label, value }: { label: string; value: string }) => (
  <div className="min-w-0">
    <div className="flex min-h-6 items-center system-md-semibold text-text-primary">{label}</div>
    <div className="mt-1.5 flex h-8 items-center justify-between gap-1 rounded-lg bg-components-input-bg-normal px-2.5 system-sm-regular text-components-input-text-filled">
      <span className="truncate" title={value}>
        {value}
      </span>
      <span
        aria-hidden="true"
        className="i-ri-arrow-down-s-line size-4 shrink-0 text-text-quaternary"
      />
    </div>
  </div>
)

const SampleNodeMetricCard = ({
  metricId,
  nodeType,
}: {
  metricId: string
  nodeType: BlockEnum
}) => {
  const { t } = useTranslation(['evaluation', 'workflow'])
  const metric = buildMetricOption(metricId)
  const visual = getMetricVisual(metricId)
  const nodeTitleKey = NODE_TITLE_KEYS[nodeType as keyof typeof NODE_TITLE_KEYS]

  return (
    <div className="overflow-hidden rounded-xl border border-components-panel-border">
      <div className="flex items-center gap-2 px-4 pt-3 pb-1">
        <div
          className={cn(
            'flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-[5px]',
            getToneClasses(visual.tone).soft,
          )}
        >
          <span aria-hidden="true" className={cn(visual.icon, 'h-3.5 w-3.5')} />
        </div>
        <div className="truncate system-md-medium text-text-secondary">{metric.label}</div>
      </div>
      <div className="px-4 pb-1 system-xs-regular text-text-tertiary">
        {getTranslatedMetricDescription(t, metric.id, metric.description)}
      </div>
      <div className="flex flex-wrap gap-1 px-3 pt-1 pb-3">
        <div className="inline-flex items-center rounded-lg border-[0.5px] border-components-panel-border-subtle bg-components-badge-white-to-dark p-1.5 shadow-xs">
          <BlockIcon type={nodeType} size="xs" className="h-4.5 w-4.5 shrink-0" />
          <span className="px-1 system-xs-regular text-text-primary">
            {nodeTitleKey ? t(($) => $[nodeTitleKey], { ns: 'workflow' }) : nodeType}
          </span>
        </div>
      </div>
    </div>
  )
}

const SampleMetrics = ({ resourceType }: { resourceType: EvaluationResourceType }) => {
  if (resourceType === 'datasets' || resourceType === 'agents') {
    return SAMPLE_FIXED_METRICS[resourceType].map(({ metricId, selected }) => (
      <FixedMetricItem
        key={metricId}
        metric={buildMetricOption(metricId)}
        selected={selected}
        onToggle={() => {}}
      />
    ))
  }

  return SAMPLE_NODE_METRICS.map(({ metricId, nodeType }) => (
    <SampleNodeMetricCard key={metricId} metricId={metricId} nodeType={nodeType} />
  ))
}

type EvaluationUpgradePreviewProps = {
  resourceType: EvaluationResourceType
}

/** A read-only Evaluation page with sample data and an upgrade prompt, for plans without Evaluation. */
const EvaluationUpgradePreview = ({ resourceType }: EvaluationUpgradePreviewProps) => {
  const { t } = useTranslation(['evaluation', 'common'])
  const condition = SAMPLE_CONDITION[resourceType]

  return (
    <div className="flex h-full min-h-0 flex-col bg-background-default">
      <div className="shrink-0 px-6 pt-4">
        <div
          role="status"
          className="relative overflow-hidden rounded-xl border border-components-panel-border bg-components-panel-bg-blur shadow-lg shadow-shadow-shadow-5 backdrop-blur-[5px]"
        >
          <div
            aria-hidden="true"
            className="absolute -inset-px bg-linear-to-r from-components-badge-status-light-normal-halo to-background-gradient-mask-transparent opacity-40"
          />
          <div className="relative flex items-center gap-3 px-3 py-2">
            <span
              aria-hidden="true"
              className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-components-button-primary-bg"
            >
              <span className="i-ri-flask-fill size-4 text-components-button-primary-text" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="system-sm-semibold text-text-primary">
                {t(($) => $['upgradePreview.title'])}
              </p>
              <p className="system-xs-regular wrap-break-word text-text-tertiary">
                {t(($) => $['upgradePreview.description'])}
              </p>
            </div>
            <UpgradeBtn loc="evaluation-preview" />
          </div>
        </div>
      </div>

      {/* The sample is for looking only: `inert` keeps its controls out of reach of pointer, keyboard, and
          assistive tech, and the faded look says so before anyone tries them. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div inert className="flex min-h-full flex-col opacity-50 select-none xl:flex-row">
          <div className="min-w-0 xl:flex-1">
            <div className="flex flex-col px-6 py-4 xl:max-w-187">
              <SectionHeader
                title={t(($) => $.title)}
                description={t(($) => $.description)}
                descriptionClassName="xl:max-w-[700px]"
                action={
                  <div className="flex shrink-0 items-center gap-2">
                    <Button variant="secondary" disabled>
                      {t(($) => $['operation.reset'], { ns: 'common' })}
                    </Button>
                    <Button variant="primary" disabled>
                      {t(($) => $['operation.save'], { ns: 'common' })}
                    </Button>
                  </div>
                }
              />
              <section className="grid grid-cols-2 gap-3 py-4 xl:max-w-175">
                <SampleField label={t(($) => $['judgeFramework.title'])} value="Ragas" />
                <SampleField label={t(($) => $['judgeModel.title'])} value="gpt-4o" />
              </section>
              <div className="border-b border-divider-subtle xl:max-w-175" />
              <section className="py-4 xl:max-w-175">
                <InlineSectionHeader title={t(($) => $['metrics.title'])} />
                <div className="mt-1 space-y-1">
                  <SampleMetrics resourceType={resourceType} />
                </div>
              </section>
              <div className="border-b border-divider-subtle xl:max-w-175" />
              <section className="py-4 xl:max-w-175">
                <InlineSectionHeader title={t(($) => $['conditions.title'])} />
                <div className="mt-2 flex items-center gap-1 rounded-lg bg-components-input-bg-normal px-2.5 py-1.5 system-sm-regular text-text-secondary">
                  <span className="truncate">{buildMetricOption(condition.metricId).label}</span>
                  <span className="px-1 text-text-tertiary">≥</span>
                  <span>{condition.value}</span>
                </div>
              </section>
            </div>
          </div>

          <div className="border-t border-divider-subtle xl:w-112.5 xl:shrink-0 xl:border-s xl:border-t-0">
            <div className="px-6 py-4">
              <div className="system-xl-semibold text-text-primary">
                {t(($) => $['batch.title'])}
              </div>
              <div className="mt-1 system-sm-regular text-text-tertiary">
                {t(($) => $['batch.description'])}
              </div>
            </div>
            <div className="flex gap-4 border-b border-divider-subtle px-6">
              <div className="border-b-2 border-text-accent-secondary pt-2 pb-2.5 system-sm-medium text-text-primary uppercase">
                {t(($) => $['batch.tabs.input-fields'])}
              </div>
              <div className="border-b-2 border-transparent pt-2 pb-2.5 system-sm-medium text-text-tertiary uppercase">
                {t(($) => $['batch.tabs.history'])}
              </div>
            </div>
            <div className="space-y-3 px-6 py-4">
              <Button variant="secondary" className="w-full justify-center" disabled>
                <span aria-hidden="true" className="me-1 i-ri-download-line h-4 w-4" />
                {t(($) => $['batch.downloadTemplate'])}
              </Button>
              <Button variant="primary" className="w-full justify-center" disabled>
                {t(($) => $['batch.uploadAndRun'])}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default EvaluationUpgradePreview
