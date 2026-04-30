'use client'

import type { ChangeEvent } from 'react'
import type { MetricSelectorProps } from './types'
import { Button } from '@langgenius/dify-ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import { useEvaluationResource, useEvaluationStore } from '../../store'
import SelectorEmptyState from './selector-empty-state'
import SelectorFooter from './selector-footer'
import SelectorMetricSection from './selector-metric-section'
import { useMetricSelectorData } from './use-metric-selector-data'

const MetricSelector = ({
  resourceType,
  resourceId,
  triggerClassName,
}: MetricSelectorProps) => {
  const { t } = useTranslation('evaluation')
  const resource = useEvaluationResource(resourceType, resourceId)
  const addCustomMetric = useEvaluationStore(state => state.addCustomMetric)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [collapsedMetricMap, setCollapsedMetricMap] = useState<Record<string, boolean>>({})
  const [expandedMetricNodesMap, setExpandedMetricNodesMap] = useState<Record<string, boolean>>({})
  const hasCustomMetric = resource.metrics.some(metric => metric.kind === 'custom-workflow')

  const {
    builtinMetricMap,
    filteredSections,
    isRemoteLoading,
    toggleNodeSelection,
  } = useMetricSelectorData({
    open,
    query,
    resourceType,
    resourceId,
  })

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)

    if (nextOpen) {
      setQuery('')
      setCollapsedMetricMap({})
      setExpandedMetricNodesMap({})
    }
  }

  const handleQueryChange = (event: ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={(
          <Button variant="ghost-accent" className={triggerClassName}>
            <span aria-hidden="true" className="mr-1 i-ri-add-line h-4 w-4" />
            {t('metrics.add')}
          </Button>
        )}
      />
      <PopoverContent popupClassName="w-[360px] overflow-hidden rounded-xl border-[0.5px] border-components-panel-border p-0 shadow-[0px_12px_16px_-4px_rgba(9,9,11,0.08),0px_4px_6px_-2px_rgba(9,9,11,0.03)]">
        <div className="flex min-h-[560px] flex-col bg-components-panel-bg">
          <div className="border-b border-divider-subtle bg-background-section-burn px-2 py-2">
            <Input
              value={query}
              showLeftIcon
              placeholder={t('metrics.searchNodeOrMetrics')}
              onChange={handleQueryChange}
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {isRemoteLoading && (
              <div className="space-y-3 px-3 py-4" data-testid="evaluation-metric-loading">
                {['metric-skeleton-1', 'metric-skeleton-2', 'metric-skeleton-3'].map(key => (
                  <div key={key} className="h-20 animate-pulse rounded-xl bg-background-default-subtle" />
                ))}
              </div>
            )}

            {!isRemoteLoading && filteredSections.length === 0 && (
              <SelectorEmptyState message={t('metrics.noResults')} />
            )}

            {!isRemoteLoading && filteredSections.map((section, index) => {
              const { metric } = section
              const isExpanded = collapsedMetricMap[metric.id] !== true
              const isShowingAllNodes = expandedMetricNodesMap[metric.id] === true

              return (
                <SelectorMetricSection
                  key={metric.id}
                  section={section}
                  index={index}
                  addedMetric={builtinMetricMap.get(metric.id)}
                  isExpanded={isExpanded}
                  isShowingAllNodes={isShowingAllNodes}
                  onToggleExpanded={() => setCollapsedMetricMap(current => ({
                    ...current,
                    [metric.id]: isExpanded,
                  }))}
                  onToggleNodeSelection={toggleNodeSelection}
                  onToggleShowAllNodes={() => setExpandedMetricNodesMap(current => ({
                    ...current,
                    [metric.id]: !isShowingAllNodes,
                  }))}
                  t={t}
                />
              )
            })}
          </div>

          <SelectorFooter
            title={t('metrics.custom.footerTitle')}
            description={hasCustomMetric ? t('metrics.custom.limitDescription') : t('metrics.custom.footerDescription')}
            disabled={hasCustomMetric}
            onClick={() => {
              addCustomMetric(resourceType, resourceId)
              setOpen(false)
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default MetricSelector
