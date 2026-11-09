'use client'

import type { EvaluationResourceProps } from '../../types'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { useDocLink } from '@/context/i18n'
import BatchTestPanel from '../batch-test-panel'
import ConditionsSection from '../conditions-section'
import EvaluationConfigActions from '../config-actions'
import EvaluationFrameworkSelector from '../evaluation-framework-selector'
import FixedMetricsSection from '../fixed-metrics-section'
import JudgeModelSelector from '../judge-model-selector'
import MetricSection from '../metric-section'
import SectionHeader, { InlineSectionHeader } from '../section-header'

const EvaluationLayout = ({ resourceType, resourceId }: EvaluationResourceProps) => {
  const { t } = useTranslation(['evaluation'])
  const { t: tCommon } = useTranslation(['common'])
  const docLink = useDocLink()
  const judgeModelTitleId = useId()

  return (
    // Side by side, each panel scrolls on its own; stacked on narrower screens, the page
    // scrolls as a whole so neither panel is squeezed into a short scroll box.
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-background-default xl:flex-row xl:overflow-hidden">
      <div className="shrink-0 xl:min-h-0 xl:flex-1 xl:shrink xl:overflow-y-auto">
        <div className="flex max-w-[748px] flex-col px-6 py-4 xl:min-h-full">
          {/* Keep Save reachable while the configuration scrolls. */}
          <SectionHeader
            className="sticky top-0 z-10 -mx-6 -mt-4 bg-background-default px-6 pt-4 pb-2"
            title={t(($) => $.title)}
            description={
              <>
                {t(($) => $.description)}{' '}
                <a
                  className="text-text-accent"
                  href={docLink()}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {tCommon(($) => $['operation.learnMore'])}
                </a>
              </>
            }
            descriptionClassName="max-w-[700px]"
            action={<EvaluationConfigActions resourceType={resourceType} resourceId={resourceId} />}
          />
          <section className="max-w-[700px] py-4">
            <EvaluationFrameworkSelector resourceType={resourceType} resourceId={resourceId} />
          </section>
          <div className="max-w-[700px] border-b border-divider-subtle" />
          <section className="max-w-[700px] py-4">
            <InlineSectionHeader
              title={t(($) => $['judgeModel.title'])}
              titleId={judgeModelTitleId}
              tooltip={t(($) => $['judgeModel.description'])}
            />
            <div className="mt-1.5">
              <JudgeModelSelector
                resourceType={resourceType}
                resourceId={resourceId}
                ariaLabelledBy={judgeModelTitleId}
              />
            </div>
          </section>
          <div className="max-w-[700px] border-b border-divider-subtle" />
          {resourceType === 'datasets' || resourceType === 'agents' ? (
            <FixedMetricsSection resourceType={resourceType} resourceId={resourceId} />
          ) : (
            <MetricSection resourceType={resourceType} resourceId={resourceId} />
          )}
          <div className="max-w-[700px] border-b border-divider-subtle" />
          <ConditionsSection resourceType={resourceType} resourceId={resourceId} />
        </div>
      </div>

      <div className="shrink-0 border-t border-divider-subtle xl:h-auto xl:w-[450px] xl:border-s xl:border-t-0">
        <BatchTestPanel resourceType={resourceType} resourceId={resourceId} />
      </div>
    </div>
  )
}

export default EvaluationLayout
