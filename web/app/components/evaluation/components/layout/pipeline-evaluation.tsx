'use client'

import type { EvaluationResourceProps } from '../../types'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { useDocLink } from '@/context/i18n'
import { useAvailableEvaluationMetrics } from '@/service/use-evaluation'
import { getEvaluationMockConfig } from '../../mock'
import { isEvaluationRunnable, useEvaluationResource, useEvaluationStore } from '../../store'
import UploadRunPopover from '../batch-test-panel/input-fields/upload-run-popover'
import { useInputFieldsActions } from '../batch-test-panel/input-fields/use-input-fields-actions'
import { usePublishedInputFields } from '../batch-test-panel/input-fields/use-published-input-fields'
import JudgeModelSelector from '../judge-model-selector'
import PipelineHistoryTable from '../pipeline/pipeline-history-table'
import PipelineMetricItem from '../pipeline/pipeline-metric-item'
import PipelineResultsPanel from '../pipeline/pipeline-results-panel'
import SectionHeader, { InlineSectionHeader } from '../section-header'

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
  const updateMetricThreshold = useEvaluationStore(state => state.updateMetricThreshold)
  const { data: availableMetricsData } = useAvailableEvaluationMetrics()
  const resource = useEvaluationResource(resourceType, resourceId)
  const config = getEvaluationMockConfig(resourceType)
  const builtinMetricMap = useMemo(() => new Map(
    resource.metrics
      .filter(metric => metric.kind === 'builtin')
      .map(metric => [metric.optionId, metric]),
  ), [resource.metrics])
  const availableMetricIds = useMemo(() => new Set(availableMetricsData?.metrics ?? []), [availableMetricsData?.metrics])
  const availableBuiltinMetrics = useMemo(() => {
    return config.builtinMetrics.filter(metric =>
      availableMetricIds.has(metric.id) || builtinMetricMap.has(metric.id),
    )
  }, [availableMetricIds, builtinMetricMap, config.builtinMetrics])
  const isConfigReady = !!resource.judgeModelId && builtinMetricMap.size > 0
  const isRunnable = isEvaluationRunnable(resource)
  const { inputFields, isInputFieldsLoading } = usePublishedInputFields(resourceType, resourceId)
  const actions = useInputFieldsActions({
    resourceType,
    resourceId,
    inputFields,
    isInputFieldsLoading,
    isPanelReady: isConfigReady,
    isRunnable,
    templateFileName: config.templateFileName,
  })

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
                {availableBuiltinMetrics.map((metric) => {
                  const selectedMetric = builtinMetricMap.get(metric.id)

                  return (
                    <PipelineMetricItem
                      key={metric.id}
                      metric={metric}
                      selected={!!selectedMetric}
                      threshold={selectedMetric?.threshold}
                      disabledCondition
                      onToggle={() => handleToggleMetric(metric.id)}
                      onThresholdChange={value => updateMetricThreshold(resourceType, resourceId, selectedMetric?.id ?? '', value)}
                    />
                  )
                })}
              </div>
            </section>

            <div className="flex gap-2 pt-2">
              <Button
                className="flex-1 justify-center"
                variant="secondary"
                disabled={!actions.canDownloadTemplate}
                onClick={actions.handleDownloadTemplate}
              >
                <span aria-hidden="true" className="mr-1 i-ri-file-excel-2-line h-4 w-4" />
                {t('batch.downloadTemplate')}
              </Button>
              <div className="flex-1">
                <UploadRunPopover
                  open={actions.isUploadPopoverOpen}
                  onOpenChange={actions.setIsUploadPopoverOpen}
                  triggerDisabled={actions.uploadButtonDisabled}
                  triggerLabel={t('pipeline.uploadAndRun')}
                  inputFields={inputFields}
                  currentFileName={actions.currentFileName}
                  currentFileExtension={actions.currentFileExtension}
                  currentFileSize={actions.currentFileSize}
                  isFileUploading={actions.isFileUploading}
                  isRunDisabled={actions.isRunDisabled}
                  isRunning={actions.isRunning}
                  onUploadFile={actions.handleUploadFile}
                  onClearUploadedFile={actions.handleClearUploadedFile}
                  onDownloadTemplate={actions.handleDownloadTemplate}
                  onRun={actions.handleRun}
                />
              </div>
            </div>
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
