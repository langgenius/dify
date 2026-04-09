'use client'

import type { EvaluationResourceProps, MetricOption } from '../types'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import Button from '@/app/components/base/button'
import Checkbox from '@/app/components/base/checkbox'
import Input from '@/app/components/base/input'
import { toast } from '@/app/components/base/ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/app/components/base/ui/tooltip'
import { useDocLink } from '@/context/i18n'
import { cn } from '@/utils/classnames'
import { getEvaluationMockConfig } from '../mock'
import { isEvaluationRunnable, useEvaluationResource, useEvaluationStore } from '../store'
import JudgeModelSelector from './judge-model-selector'
import SectionHeader, { InlineSectionHeader } from './section-header'

type PipelineMetricItemProps = {
  metric: MetricOption
  selected: boolean
  onToggle: () => void
  disabledCondition: boolean
}

const PipelineMetricItem = ({
  metric,
  selected,
  onToggle,
  disabledCondition,
}: PipelineMetricItemProps) => {
  return (
    <div className="flex items-center justify-between gap-3 px-1 py-1">
      <button
        type="button"
        className="flex min-w-0 items-center gap-2 text-left"
        onClick={onToggle}
      >
        <Checkbox checked={selected} />
        <span className="truncate system-sm-medium text-text-secondary">{metric.label}</span>
        <Tooltip>
          <TooltipTrigger
            render={(
              <span className="flex h-4 w-4 items-center justify-center text-text-quaternary">
                <span aria-hidden="true" className="i-ri-question-line h-3.5 w-3.5" />
              </span>
            )}
          />
          <TooltipContent>
            {metric.description}
          </TooltipContent>
        </Tooltip>
      </button>

      <button
        type="button"
        disabled={disabledCondition}
        className={cn(
          'system-xs-medium text-text-tertiary',
          disabledCondition && 'cursor-not-allowed text-components-button-secondary-accent-text-disabled',
        )}
      >
        + Condition
      </button>
    </div>
  )
}

const PipelineHistoryTable = ({
  resourceType,
  resourceId,
}: EvaluationResourceProps) => {
  const { t } = useTranslation('evaluation')
  const resource = useEvaluationResource(resourceType, resourceId)
  const [query, setQuery] = useState('')
  const statusLabels = {
    running: t('batch.status.running'),
    success: t('batch.status.success'),
    failed: t('batch.status.failed'),
  }

  const filteredRecords = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword)
      return resource.batchRecords

    return resource.batchRecords.filter(record =>
      record.fileName.toLowerCase().includes(keyword)
      || record.summary.toLowerCase().includes(keyword),
    )
  }, [query, resource.batchRecords])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-3 px-6 pt-4 pb-2">
        <div className="system-xl-semibold text-text-primary">{t('history.title')}</div>
        <div className="w-[160px] shrink-0 sm:w-[200px]">
          <Input
            value={query}
            showLeftIcon
            placeholder={t('history.searchPlaceholder')}
            onChange={event => setQuery(event.target.value)}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 px-4 pb-4">
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-effects-highlight bg-background-default">
          <div className="grid grid-cols-[minmax(0,1.8fr)_80px_80px_80px_40px] rounded-t-lg bg-background-section px-2 py-1">
            <div className="flex items-center gap-1 px-2 system-xs-medium-uppercase text-text-tertiary">
              <span>{t('history.columns.time')}</span>
              <span aria-hidden="true" className="i-ri-arrow-down-line h-3 w-3" />
            </div>
            <div className="px-2 system-xs-medium-uppercase text-text-tertiary">{t('history.columns.creator')}</div>
            <div className="px-2 system-xs-medium-uppercase text-text-tertiary">{t('history.columns.version')}</div>
            <div className="px-2 text-center system-xs-medium-uppercase text-text-tertiary">{t('history.columns.status')}</div>
            <div />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {filteredRecords.length > 0 && (
              <div className="divide-y divide-divider-subtle">
                {filteredRecords.map(record => (
                  <div
                    key={record.id}
                    className="grid grid-cols-[minmax(0,1.8fr)_80px_80px_80px_40px] items-center px-2 py-2"
                  >
                    <div className="truncate px-2 system-sm-regular text-text-secondary">{record.startedAt}</div>
                    <div className="truncate px-2 system-sm-regular text-text-secondary">{t('history.creatorYou')}</div>
                    <div className="truncate px-2 system-sm-regular text-text-secondary">{t('history.latestVersion')}</div>
                    <div className="flex justify-center px-2">
                      <Badge
                        className={cn(
                          record.status === 'failed' && 'badge-warning',
                          record.status === 'success' && 'badge-accent',
                        )}
                      >
                        {record.status === 'running'
                          ? (
                              <span className="flex items-center gap-1">
                                <span aria-hidden="true" className="i-ri-loader-4-line h-3 w-3 animate-spin" />
                                {statusLabels.running}
                              </span>
                            )
                          : statusLabels[record.status]}
                      </Badge>
                    </div>
                    <div className="flex justify-center">
                      <button
                        type="button"
                        className="flex h-6 w-6 items-center justify-center rounded-md text-text-quaternary hover:bg-state-base-hover"
                        aria-label={record.summary}
                      >
                        <span aria-hidden="true" className="i-ri-more-2-line h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {filteredRecords.length === 0 && (
              <div className="flex h-full min-h-[321px] flex-col items-center justify-center gap-2 px-4 text-center">
                <span aria-hidden="true" className="i-ri-history-line h-5 w-5 text-text-quaternary" />
                <div className="system-sm-medium text-text-quaternary">{t('history.empty')}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

const PipelineResultsPanel = () => {
  const { t } = useTranslation('evaluation')

  return (
    <div className="flex min-h-[360px] flex-1 items-center justify-center xl:min-h-0">
      <div className="flex flex-col items-center gap-4 px-4 text-center">
        <span aria-hidden="true" className="i-ri-file-list-3-line h-12 w-12 text-text-quaternary" />
        <div className="system-md-medium text-text-quaternary">{t('results.empty')}</div>
      </div>
    </div>
  )
}

const PipelineEvaluation = ({
  resourceType,
  resourceId,
}: EvaluationResourceProps) => {
  const { t } = useTranslation('evaluation')
  const { t: tCommon } = useTranslation('common')
  const docLink = useDocLink()
  const ensureResource = useEvaluationStore(state => state.ensureResource)
  const addBuiltinMetric = useEvaluationStore(state => state.addBuiltinMetric)
  const removeMetric = useEvaluationStore(state => state.removeMetric)
  const setUploadedFileName = useEvaluationStore(state => state.setUploadedFileName)
  const runBatchTest = useEvaluationStore(state => state.runBatchTest)
  const resource = useEvaluationResource(resourceType, resourceId)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const config = getEvaluationMockConfig(resourceType)
  const builtinMetricMap = useMemo(() => new Map(
    resource.metrics
      .filter(metric => metric.kind === 'builtin')
      .map(metric => [metric.optionId, metric]),
  ), [resource.metrics])
  const isConfigReady = !!resource.judgeModelId && builtinMetricMap.size > 0
  const isRunnable = isEvaluationRunnable(resource)

  useEffect(() => {
    ensureResource(resourceType, resourceId)
  }, [ensureResource, resourceId, resourceType])

  const handleToggleMetric = (metricId: string) => {
    const selectedMetric = builtinMetricMap.get(metricId)
    if (selectedMetric) {
      removeMetric(resourceType, resourceId, selectedMetric.id)
      return
    }

    addBuiltinMetric(resourceType, resourceId, metricId)
  }

  const handleDownloadTemplate = () => {
    const content = ['case_id,input,expected', '1,Example input,Example output'].join('\n')
    const link = document.createElement('a')
    link.href = `data:text/csv;charset=utf-8,${encodeURIComponent(content)}`
    link.download = config.templateFileName
    link.click()
  }

  const handleUploadAndRun = () => {
    if (!isRunnable) {
      toast.warning(t('batch.validation'))
      return
    }

    fileInputRef.current?.click()
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background-default xl:flex-row">
      <div className="flex min-h-0 flex-col border-b border-divider-subtle bg-background-default xl:w-[450px] xl:shrink-0 xl:border-r xl:border-b-0">
        <div className="px-6 pt-4 pb-2">
          <SectionHeader
            title={t('title')}
            description={(
              <>
                {t('description')}
                {' '}
                <a
                  className="text-text-accent"
                  href={docLink()}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {tCommon('operation.learnMore')}
                </a>
              </>
            )}
          />
        </div>

        <div className="px-6 pt-3 pb-4">
          <div className="space-y-3">
            <section>
              <InlineSectionHeader title={t('judgeModel.title')} tooltip={t('judgeModel.description')} />
              <div className="mt-1">
                <JudgeModelSelector
                  resourceType={resourceType}
                  resourceId={resourceId}
                  autoSelectFirst={false}
                />
              </div>
            </section>

            <section>
              <InlineSectionHeader title={t('metrics.title')} tooltip={t('metrics.description')} />
              <div className="mt-1 space-y-0.5">
                {config.builtinMetrics.map(metric => (
                  <PipelineMetricItem
                    key={metric.id}
                    metric={metric}
                    selected={builtinMetricMap.has(metric.id)}
                    disabledCondition
                    onToggle={() => handleToggleMetric(metric.id)}
                  />
                ))}
              </div>
            </section>

            <div className="flex gap-2 pt-2">
              <Button
                className="flex-1 justify-center"
                variant="secondary"
                disabled={!isConfigReady}
                onClick={handleDownloadTemplate}
              >
                <span aria-hidden="true" className="mr-1 i-ri-file-excel-2-line h-4 w-4" />
                {t('batch.downloadTemplate')}
              </Button>
              <Button
                className="flex-1 justify-center"
                variant="primary"
                disabled={!isConfigReady}
                onClick={handleUploadAndRun}
              >
                {t('pipeline.uploadAndRun')}
              </Button>
            </div>

            <input
              ref={fileInputRef}
              hidden
              type="file"
              accept=".csv,.xlsx"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (!file)
                  return

                setUploadedFileName(resourceType, resourceId, file.name)
                runBatchTest(resourceType, resourceId)
                event.target.value = ''
              }}
            />
          </div>
        </div>

        <div className="border-t border-divider-subtle" />

        <PipelineHistoryTable
          resourceType={resourceType}
          resourceId={resourceId}
        />
      </div>

      <div className="min-h-0 flex-1 bg-background-default">
        <PipelineResultsPanel />
      </div>
    </div>
  )
}

export default PipelineEvaluation
