import type { TFunction } from 'i18next'
import type { EvaluationMetric } from '../../types'
import type { MetricSelectorSection } from './types'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useTranslation } from 'react-i18next'
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
  onToggleNodeSelection: (
    metric: MetricSelectorSection['metric'],
    nodeInfo: MetricSelectorSection['visibleNodes'][number],
  ) => void
  t: TFunction<['evaluation']>
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
  const { t: tCommon } = useTranslation(['common'])
  const { metric, visibleNodes, hasNoNodeInfo } = section
  const selectedNodeIds = new Set(
    addedMetric?.nodeInfoList?.length
      ? addedMetric.nodeInfoList.map((nodeInfo) => nodeInfo.node_id)
      : [],
  )
  const metricVisual = getMetricVisual(metric.id)
  const toneClasses = getToneClasses(metricVisual.tone)
  const isNodeAdded = (nodeId: string) =>
    addedMetric ? (addedMetric.nodeInfoList?.length ? selectedNodeIds.has(nodeId) : true) : false
  const addedNodeCount = visibleNodes.filter((nodeInfo) => isNodeAdded(nodeInfo.node_id)).length
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
          aria-expanded={isExpanded}
          className="flex min-w-0 items-center gap-2"
          onClick={onToggleExpanded}
        >
          <div
            className={cn(
              'flex h-[18px] w-[18px] items-center justify-center rounded-md',
              toneClasses.soft,
            )}
          >
            <span aria-hidden="true" className={cn(metricVisual.icon, 'h-3.5 w-3.5')} />
          </div>
          <div className="flex items-center gap-1">
            <span className="truncate system-xs-medium-uppercase text-text-secondary">
              {metric.label}
            </span>
            <span
              aria-hidden="true"
              className={cn(
                'i-ri-arrow-down-s-line h-4 w-4 text-text-quaternary transition-transform',
                !isExpanded && '-rotate-90',
              )}
            />
          </div>
        </button>

        <div className="flex shrink-0 items-center gap-2">
          {addedNodeCount > 0 && (
            <span className="system-xs-regular text-text-tertiary">
              {t(($) => $['metrics.nodesSelectedCount'], {
                selected: addedNodeCount,
                total: visibleNodes.length,
              })}
            </span>
          )}
          {metric.description && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className="p-px text-text-quaternary transition-colors hover:text-text-tertiary"
                    aria-label={metric.label}
                  >
                    <span aria-hidden="true" className="i-ri-question-line h-[14px] w-[14px]" />
                  </button>
                }
              />
              <TooltipContent className="max-w-[260px]">{metric.description}</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {isExpanded && (
        <div className="px-1 py-1">
          {hasNoNodeInfo && (
            <div className="px-3 pt-0.5 pb-2 system-sm-regular text-text-tertiary">
              {t(($) => $['metrics.noNodesInWorkflow'])}
            </div>
          )}
          {shownNodes.map((nodeInfo) => {
            const isAdded = isNodeAdded(nodeInfo.node_id)

            return (
              <button
                key={nodeInfo.node_id}
                data-testid={`evaluation-metric-node-${metric.id}-${nodeInfo.node_id}`}
                type="button"
                // Clicking an added node removes it, so expose the row as a pressed toggle.
                aria-pressed={isAdded}
                className={cn(
                  'group/node flex w-full items-center gap-1 rounded-md px-3 py-1.5 text-start transition-colors',
                  // Keep added nodes marked without needing a hover.
                  isAdded
                    ? 'bg-state-accent-hover hover:bg-state-accent-hover-alt'
                    : 'hover:bg-state-base-hover-alt',
                )}
                onClick={() => onToggleNodeSelection(metric, nodeInfo)}
              >
                <div className="flex min-w-0 flex-1 items-center gap-2.5 pe-1">
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
                  <span className="flex shrink-0 items-center gap-0.5 px-1 system-xs-regular">
                    <span className="flex items-center gap-0.5 text-text-accent group-hover/node:hidden group-focus-visible/node:hidden">
                      <span aria-hidden="true" className="i-ri-check-line h-3.5 w-3.5" />
                      {t(($) => $['metrics.added'])}
                    </span>
                    <span
                      aria-hidden="true"
                      className="hidden text-text-destructive group-hover/node:inline group-focus-visible/node:inline"
                    >
                      {tCommon(($) => $['operation.remove'])}
                    </span>
                  </span>
                )}
              </button>
            )
          })}
          {hasMoreNodes && (
            <button
              type="button"
              className="flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-start hover:bg-state-base-hover-alt"
              onClick={onToggleShowAllNodes}
            >
              <div className="flex min-w-0 flex-1 items-center gap-1.5 pe-1">
                <div className="flex items-center px-1 text-text-tertiary">
                  <span
                    aria-hidden="true"
                    className={cn(
                      isShowingAllNodes ? 'i-ri-subtract-line' : 'i-ri-more-line',
                      'h-4 w-4',
                    )}
                  />
                </div>
                <span className="truncate system-xs-regular text-text-tertiary">
                  {isShowingAllNodes
                    ? t(($) => $['metrics.showLess'])
                    : t(($) => $['metrics.showMore'])}
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
