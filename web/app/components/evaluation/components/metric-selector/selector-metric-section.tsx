import type { TFunction } from 'i18next'
import type { EvaluationMetric } from '../../types'
import type { MetricSelectorSection } from './types'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import BlockIcon from '@/app/components/workflow/block-icon'
import { getEvaluationNodeBlockType, getMetricVisual, getToneClasses } from './utils'

type SelectorMetricSectionProps = {
  section: MetricSelectorSection
  index: number
  addedMetric?: EvaluationMetric
  isExpanded: boolean
  isShowingAllNodes: boolean
  onToggleExpanded: () => void
  onToggleShowAllNodes: () => void
  onToggleNodeSelection: (metric: MetricSelectorSection['metric'], nodeInfo: MetricSelectorSection['visibleNodes'][number]) => void
  t: TFunction<'evaluation'>
}

const SelectorMetricSection = ({
  section,
  index,
  addedMetric,
  isExpanded,
  isShowingAllNodes,
  onToggleExpanded,
  onToggleShowAllNodes,
  onToggleNodeSelection,
  t,
}: SelectorMetricSectionProps) => {
  const { metric, visibleNodes, hasNoNodeInfo } = section
  const selectedNodeIds = new Set(
    addedMetric?.nodeInfoList?.length
      ? addedMetric.nodeInfoList.map(nodeInfo => nodeInfo.node_id)
      : [],
  )
  const metricVisual = getMetricVisual(metric.id)
  const toneClasses = getToneClasses(metricVisual.tone)
  const hasMoreNodes = visibleNodes.length > 3
  const shownNodes = hasMoreNodes && !isShowingAllNodes ? visibleNodes.slice(0, 3) : visibleNodes

  return (
    <div data-testid={`evaluation-metric-option-${metric.id}`}>
      {index > 0 && (
        <div className="px-3 pt-1">
          <div className="h-px w-full bg-divider-subtle" />
        </div>
      )}

      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <button
          type="button"
          className="flex min-w-0 items-center gap-2"
          onClick={onToggleExpanded}
        >
          <div className={cn('flex h-[18px] w-[18px] items-center justify-center rounded-md', toneClasses.soft)}>
            <span aria-hidden="true" className={cn(metricVisual.icon, 'h-3.5 w-3.5')} />
          </div>
          <div className="flex items-center gap-1">
            <span className="truncate system-xs-medium-uppercase text-text-secondary">{metric.label}</span>
            <span
              aria-hidden="true"
              className={cn('i-ri-arrow-down-s-line h-4 w-4 text-text-quaternary transition-transform', !isExpanded && '-rotate-90')}
            />
          </div>
        </button>

        {metric.description && (
          <Tooltip>
            <TooltipTrigger
              render={(
                <button
                  type="button"
                  className="p-px text-text-quaternary transition-colors hover:text-text-tertiary"
                  aria-label={metric.label}
                >
                  <span aria-hidden="true" className="i-ri-question-line h-[14px] w-[14px]" />
                </button>
              )}
            />
            <TooltipContent className="max-w-[260px]">
              {metric.description}
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      {isExpanded && (
        <div className="px-1 py-1">
          {hasNoNodeInfo && (
            <div className="px-3 pt-0.5 pb-2 system-sm-regular text-text-tertiary">
              {t('metrics.noNodesInWorkflow')}
            </div>
          )}
          {shownNodes.map((nodeInfo) => {
            const isAdded = addedMetric
              ? addedMetric.nodeInfoList?.length
                ? selectedNodeIds.has(nodeInfo.node_id)
                : true
              : false

            return (
              <button
                key={nodeInfo.node_id}
                data-testid={`evaluation-metric-node-${metric.id}-${nodeInfo.node_id}`}
                type="button"
                className={cn(
                  'flex w-full items-center gap-1 rounded-md px-3 py-1.5 text-left transition-colors hover:bg-state-base-hover-alt',
                  isAdded && 'opacity-50',
                )}
                onClick={() => onToggleNodeSelection(metric, nodeInfo)}
              >
                <div className="flex min-w-0 flex-1 items-center gap-2.5 pr-1">
                  <BlockIcon
                    type={getEvaluationNodeBlockType(nodeInfo)}
                    size="xs"
                    className="h-[18px] w-[18px] shrink-0"
                  />
                  <span className="truncate text-[13px] leading-4 font-medium text-text-secondary">
                    {nodeInfo.title}
                  </span>
                </div>
                {isAdded && (
                  <span className="shrink-0 px-1 system-xs-regular text-text-quaternary">{t('metrics.added')}</span>
                )}
              </button>
            )
          })}
          {hasMoreNodes && (
            <button
              type="button"
              className="flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left hover:bg-state-base-hover-alt"
              onClick={onToggleShowAllNodes}
            >
              <div className="flex min-w-0 flex-1 items-center gap-1.5 pr-1">
                <div className="flex items-center px-1 text-text-tertiary">
                  <span aria-hidden="true" className={cn(isShowingAllNodes ? 'i-ri-subtract-line' : 'i-ri-more-line', 'h-4 w-4')} />
                </div>
                <span className="truncate system-xs-regular text-text-tertiary">
                  {isShowingAllNodes ? t('metrics.showLess') : t('metrics.showMore')}
                </span>
              </div>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default SelectorMetricSection
