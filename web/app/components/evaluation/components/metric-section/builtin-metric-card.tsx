'use client'

import type { EvaluationMetric, EvaluationResourceProps } from '../../types'
import type { NodeInfo } from '@/types/evaluation'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import BlockIcon from '@/app/components/workflow/block-icon'
import { useEvaluationStore } from '../../store'
import { dedupeNodeInfoList, getEvaluationNodeBlockType, getMetricVisual, getToneClasses } from '../metric-selector/utils'

type BuiltinMetricCardProps = EvaluationResourceProps & {
  metric: EvaluationMetric
  availableNodeInfoList?: NodeInfo[]
}

const BuiltinMetricCard = ({
  resourceType,
  resourceId,
  metric,
  availableNodeInfoList = [],
}: BuiltinMetricCardProps) => {
  const { t } = useTranslation('evaluation')
  const updateBuiltinMetric = useEvaluationStore(state => state.addBuiltinMetric)
  const removeMetric = useEvaluationStore(state => state.removeMetric)
  const [isExpanded, setIsExpanded] = useState(true)
  const metricVisual = getMetricVisual(metric.optionId)
  const metricToneClasses = getToneClasses(metricVisual.tone)
  const selectedNodeInfoList = metric.nodeInfoList ?? []
  const selectedNodeIdSet = new Set(selectedNodeInfoList.map(nodeInfo => nodeInfo.node_id))
  const selectableNodeInfoList = selectedNodeInfoList.length > 0
    ? availableNodeInfoList.filter(nodeInfo => !selectedNodeIdSet.has(nodeInfo.node_id))
    : []
  const shouldShowAddNode = selectableNodeInfoList.length > 0
  const handleRemoveNode = (nodeId: string) => {
    const nextSelectedNodeInfoList = selectedNodeInfoList.filter(item => item.node_id !== nodeId)

    if (nextSelectedNodeInfoList.length === 0) {
      removeMetric(resourceType, resourceId, metric.id)
      return
    }

    updateBuiltinMetric(resourceType, resourceId, metric.optionId, nextSelectedNodeInfoList)
  }

  return (
    <div className="group overflow-hidden rounded-xl border border-components-panel-border hover:bg-background-section">
      <div className={cn('flex items-center justify-between gap-3 px-3 pt-3', isExpanded ? 'pb-1' : 'pb-3')}>
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 px-1 text-left"
          aria-expanded={isExpanded}
          aria-label={isExpanded ? t('metrics.collapseNodes') : t('metrics.expandNodes')}
          onClick={() => setIsExpanded(current => !current)}
        >
          <div className={cn('flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px]', metricToneClasses.soft)}>
            <span aria-hidden="true" className={cn(metricVisual.icon, 'h-3.5 w-3.5')} />
          </div>
          <div className="flex min-w-0 items-center gap-0.5">
            <div className="truncate system-md-medium text-text-secondary uppercase">{metric.label}</div>
            <span
              aria-hidden="true"
              className={cn('i-ri-arrow-down-s-line h-4 w-4 shrink-0 text-text-quaternary transition-transform', !isExpanded && '-rotate-90')}
            />
          </div>
        </button>

        <Button
          size="small"
          variant="ghost"
          aria-label={t('metrics.remove')}
          className="h-6 w-6 shrink-0 rounded-md p-0 text-text-quaternary opacity-0 transition-opacity group-hover:opacity-100 hover:text-text-secondary focus-visible:opacity-100"
          onClick={() => removeMetric(resourceType, resourceId, metric.id)}
        >
          <span aria-hidden="true" className="i-ri-delete-bin-line h-4 w-4" />
        </Button>
      </div>

      {isExpanded && (
        <div className="flex flex-wrap gap-1 px-3 pt-1 pb-3">
          {selectedNodeInfoList.length
            ? selectedNodeInfoList.map((nodeInfo) => {
                return (
                  <div
                    key={nodeInfo.node_id}
                    className="inline-flex min-w-[18px] items-center rounded-lg border-[0.5px] border-components-panel-border-subtle bg-components-badge-white-to-dark p-1.5 shadow-xs"
                  >
                    <BlockIcon
                      type={getEvaluationNodeBlockType(nodeInfo)}
                      size="xs"
                      className="h-[18px] w-[18px] shrink-0"
                    />
                    <span className="px-1 system-xs-regular text-text-primary">{nodeInfo.title}</span>
                    <button
                      type="button"
                      className="flex h-4 w-4 items-center justify-center rounded-sm text-text-quaternary transition-colors hover:text-text-secondary"
                      aria-label={nodeInfo.title}
                      onClick={() => handleRemoveNode(nodeInfo.node_id)}
                    >
                      <span aria-hidden="true" className="i-custom-vender-solid-general-x-circle h-3.5 w-3.5" />
                    </button>
                  </div>
                )
              })
            : (
                <span className="px-1 system-xs-regular text-text-tertiary">{t('metrics.nodesAll')}</span>
              )}

          {shouldShowAddNode && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={(
                  <button
                    type="button"
                    aria-label={t('metrics.addNode')}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-background-default-hover text-text-tertiary transition-colors hover:bg-state-base-hover"
                  />
                )}
              >
                <span aria-hidden="true" className="i-ri-add-line h-4 w-4 shrink-0" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                placement="bottom-start"
                popupClassName="w-[252px] rounded-md border-[0.5px] border-components-panel-border py-1 shadow-[0px_12px_16px_-4px_rgba(9,9,11,0.08),0px_4px_6px_-2px_rgba(9,9,11,0.03)]"
              >
                {selectableNodeInfoList.map((nodeInfo) => {
                  return (
                    <DropdownMenuItem
                      key={nodeInfo.node_id}
                      className="h-auto gap-0 rounded-md px-3 py-1.5"
                      onClick={() => updateBuiltinMetric(
                        resourceType,
                        resourceId,
                        metric.optionId,
                        dedupeNodeInfoList([...selectedNodeInfoList, nodeInfo]),
                      )}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2.5 pr-1">
                        <BlockIcon
                          type={getEvaluationNodeBlockType(nodeInfo)}
                          size="xs"
                          className="h-[18px] w-[18px] shrink-0"
                        />
                        <span className="truncate system-sm-medium text-text-secondary">{nodeInfo.title}</span>
                      </div>
                    </DropdownMenuItem>
                  )
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}
    </div>
  )
}

export default BuiltinMetricCard
