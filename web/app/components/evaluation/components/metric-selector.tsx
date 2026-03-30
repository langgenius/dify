'use client'

import type { ChangeEvent } from 'react'
import type { EvaluationResourceProps } from '../types'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/app/components/base/ui/popover'
import { cn } from '@/utils/classnames'
import { getEvaluationMockConfig } from '../mock'
import { useEvaluationResource, useEvaluationStore } from '../store'

const MetricSelector = ({
  resourceType,
  resourceId,
}: EvaluationResourceProps) => {
  const { t } = useTranslation('evaluation')
  const config = getEvaluationMockConfig(resourceType)
  const metricGroupLabels = {
    quality: t('metrics.groups.quality'),
    operations: t('metrics.groups.operations'),
  }
  const metrics = useEvaluationResource(resourceType, resourceId).metrics
  const addBuiltinMetric = useEvaluationStore(state => state.addBuiltinMetric)
  const addCustomMetric = useEvaluationStore(state => state.addCustomMetric)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const loadingTimerRef = useRef<number | null>(null)

  const triggerLoading = () => {
    if (loadingTimerRef.current)
      window.clearTimeout(loadingTimerRef.current)

    setIsLoading(true)
    loadingTimerRef.current = window.setTimeout(() => {
      setIsLoading(false)
    }, 180)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)

    if (nextOpen) {
      triggerLoading()
      return
    }

    if (loadingTimerRef.current)
      window.clearTimeout(loadingTimerRef.current)
    setIsLoading(false)
  }

  const handleQueryChange = (event: ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value)
    if (open)
      triggerLoading()
  }

  useEffect(() => {
    return () => {
      if (loadingTimerRef.current)
        window.clearTimeout(loadingTimerRef.current)
    }
  }, [])

  const filteredGroups = useMemo(() => {
    const filteredMetrics = config.builtinMetrics.filter((metric) => {
      const keyword = query.trim().toLowerCase()
      if (!keyword)
        return true

      return metric.label.toLowerCase().includes(keyword) || metric.description.toLowerCase().includes(keyword)
    })

    const grouped = filteredMetrics.reduce<Record<string, typeof filteredMetrics>>((acc, metric) => {
      acc[metric.group] = [...(acc[metric.group] ?? []), metric]
      return acc
    }, {})

    return Object.entries(grouped)
  }, [config.builtinMetrics, query])

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger className="btn btn-medium btn-secondary inline-flex items-center">
        <span aria-hidden="true" className="i-ri-add-line mr-1 h-4 w-4" />
        {t('metrics.add')}
      </PopoverTrigger>
      <PopoverContent popupClassName="w-[360px] p-3">
        <div className="space-y-3">
          <Input
            value={query}
            showLeftIcon
            placeholder={t('metrics.searchPlaceholder')}
            onChange={handleQueryChange}
          />
          <div className="max-h-[320px] space-y-3 overflow-y-auto pr-1">
            {isLoading && (
              <div className="space-y-2" data-testid="evaluation-metric-loading">
                {['metric-skeleton-1', 'metric-skeleton-2', 'metric-skeleton-3'].map(key => (
                  <div key={key} className="h-14 animate-pulse rounded-xl bg-background-default-subtle" />
                ))}
              </div>
            )}
            {!isLoading && filteredGroups.length === 0 && (
              <div className="rounded-xl border border-dashed border-divider-subtle px-4 py-8 text-center text-text-tertiary system-sm-regular">
                {t('metrics.noResults')}
              </div>
            )}
            {!isLoading && filteredGroups.map(([groupName, options]) => {
              const shownOptions = showAll ? options : options.slice(0, 2)
              return (
                <div key={groupName}>
                  <div className="mb-2 text-text-tertiary system-xs-medium-uppercase">{metricGroupLabels[groupName as keyof typeof metricGroupLabels] ?? groupName}</div>
                  <div className="space-y-2">
                    {shownOptions.map(option => (
                      <button
                        key={option.id}
                        type="button"
                        className="w-full rounded-xl border border-divider-subtle px-3 py-3 text-left hover:border-components-button-secondary-border hover:bg-state-base-hover-alt"
                        onClick={() => {
                          addBuiltinMetric(resourceType, resourceId, option.id)
                          setOpen(false)
                        }}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-text-primary system-sm-semibold">{option.label}</div>
                            <div className="mt-1 text-text-tertiary system-xs-regular">{option.description}</div>
                          </div>
                          {metrics.some(metric => metric.optionId === option.id && metric.kind === 'builtin') && (
                            <Badge className="badge-accent">{t('metrics.added')}</Badge>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
          {filteredGroups.some(([, options]) => options.length > 2) && (
            <button
              type="button"
              className="flex items-center text-text-accent system-sm-medium"
              onClick={() => setShowAll(value => !value)}
            >
              {showAll ? t('metrics.showLess') : t('metrics.showMore')}
              <span
                aria-hidden="true"
                className={cn('i-ri-arrow-down-s-line ml-1 h-4 w-4 transition-transform', showAll && 'rotate-180')}
              />
            </button>
          )}
          <div className="border-t border-divider-subtle pt-3">
            <Button
              className="w-full justify-center"
              variant="ghost-accent"
              onClick={() => {
                addCustomMetric(resourceType, resourceId)
                setOpen(false)
              }}
            >
              {t('metrics.addCustom')}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default MetricSelector
