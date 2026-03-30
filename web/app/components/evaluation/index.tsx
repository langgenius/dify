'use client'

import type { EvaluationResourceProps } from './types'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import BatchTestPanel from './components/batch-test-panel'
import ConditionsSection from './components/conditions-section'
import JudgeModelSelector from './components/judge-model-selector'
import MetricSection from './components/metric-section'
import SectionHeader from './components/section-header'
import { useEvaluationStore } from './store'

const Evaluation = ({
  resourceType,
  resourceId,
}: EvaluationResourceProps) => {
  const { t } = useTranslation('evaluation')
  const ensureResource = useEvaluationStore(state => state.ensureResource)

  useEffect(() => {
    ensureResource(resourceType, resourceId)
  }, [ensureResource, resourceId, resourceType])

  return (
    <div className="flex h-full min-h-0 flex-col bg-background-body xl:flex-row">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 xl:px-8">
        <div className="mx-auto max-w-5xl space-y-6">
          <SectionHeader title={t('title')} description={t('description')} />
          <section className="rounded-2xl border border-divider-subtle bg-components-card-bg p-5">
            <SectionHeader title={t('judgeModel.title')} description={t('judgeModel.description')} />
            <div className="mt-4 max-w-[360px]">
              <JudgeModelSelector resourceType={resourceType} resourceId={resourceId} />
            </div>
          </section>
          <MetricSection resourceType={resourceType} resourceId={resourceId} />
          <ConditionsSection resourceType={resourceType} resourceId={resourceId} />
        </div>
      </div>

      <div className="h-[420px] shrink-0 xl:h-auto xl:w-[360px]">
        <BatchTestPanel resourceType={resourceType} resourceId={resourceId} />
      </div>
    </div>
  )
}

export default Evaluation
