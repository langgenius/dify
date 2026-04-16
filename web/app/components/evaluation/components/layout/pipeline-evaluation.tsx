'use client'

import type { EvaluationResourceProps } from '../../types'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useDocLink } from '@/context/i18n'
import { useEvaluationStore } from '../../store'
import HistoryTab from '../batch-test-panel/history-tab'
import JudgeModelSelector from '../judge-model-selector'
import PipelineBatchActions from '../pipeline/pipeline-batch-actions'
import PipelineMetricsSection from '../pipeline/pipeline-metrics-section'
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

  useEffect(() => {
    ensureResource(resourceType, resourceId)
  }, [ensureResource, resourceId, resourceType])

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

            <PipelineMetricsSection
              resourceType={resourceType}
              resourceId={resourceId}
            />

            <PipelineBatchActions
              resourceType={resourceType}
              resourceId={resourceId}
            />
          </div>
        </div>

        <div className="border-t border-divider-subtle" />

        <div className="min-h-0 flex-1 px-6 py-4">
          <HistoryTab
            resourceType={resourceType}
            resourceId={resourceId}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 bg-background-default">
        <PipelineResultsPanel
          resourceType={resourceType}
          resourceId={resourceId}
        />
      </div>
    </div>
  )
}

export default PipelineEvaluation
