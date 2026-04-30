'use client'

import type { NonPipelineEvaluationResourceProps } from '../../types'
import { useTranslation } from 'react-i18next'
import { useDocLink } from '@/context/i18n'
import BatchTestPanel from '../batch-test-panel'
import ConditionsSection from '../conditions-section'
import EvaluationConfigActions from '../config-actions'
import JudgeModelSelector from '../judge-model-selector'
import MetricSection from '../metric-section'
import SectionHeader, { InlineSectionHeader } from '../section-header'

const NonPipelineEvaluation = ({
  resourceType,
  resourceId,
}: NonPipelineEvaluationResourceProps) => {
  const { t } = useTranslation('evaluation')
  const { t: tCommon } = useTranslation('common')
  const docLink = useDocLink()

  return (
    <div className="flex h-full min-h-0 flex-col bg-background-default xl:flex-row">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex min-h-full max-w-[748px] flex-col px-6 py-4">
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
            descriptionClassName="max-w-[700px]"
            action={<EvaluationConfigActions resourceType={resourceType} resourceId={resourceId} />}
          />
          <section className="max-w-[700px] py-4">
            <InlineSectionHeader title={t('judgeModel.title')} tooltip={t('judgeModel.description')} />
            <div className="mt-1.5">
              <JudgeModelSelector resourceType={resourceType} resourceId={resourceId} />
            </div>
          </section>
          <div className="max-w-[700px] border-b border-divider-subtle" />
          <MetricSection resourceType={resourceType} resourceId={resourceId} />
          <div className="max-w-[700px] border-b border-divider-subtle" />
          <ConditionsSection resourceType={resourceType} resourceId={resourceId} />
        </div>
      </div>

      <div className="h-[420px] shrink-0 border-t border-divider-subtle xl:h-auto xl:w-[450px] xl:border-t-0 xl:border-l">
        <BatchTestPanel resourceType={resourceType} resourceId={resourceId} />
      </div>
    </div>
  )
}

export default NonPipelineEvaluation
