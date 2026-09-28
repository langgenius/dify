'use client'

import type { RecommendedAppResponse } from '@dify/contracts/api/console/explore/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CreateAppCreationFlow } from '@/app/components/app/create-app-entry'
import LearnDify from '@/app/components/explore/learn-dify'
import { MAIN_NAV_APP_CARD_GRID_CLASS_NAME } from '@/app/components/main-nav/app-card-grid'
import { STEP_BY_STEP_TOUR_TARGETS } from '@/app/components/step-by-step-tour/target-registry'
import FirstEmptyActionCard from './action-card'

const EMPTY_PLACEHOLDER_CARD_IDS = Array.from(
  { length: 16 },
  (_, index) => `placeholder-card-${index}`,
)

type Props = {
  onCreateLearnDify?: (app: RecommendedAppResponse) => void
  onCreateTemplate: () => void
  onImportDSL: () => void
  onTryLearnDify?: (app: RecommendedAppResponse) => void
  showLearnDify: boolean
}

function FirstEmptyState({
  onCreateLearnDify,
  onCreateTemplate,
  onImportDSL,
  onTryLearnDify,
  showLearnDify,
}: Props) {
  const { t } = useTranslation(['app'])
  const [moreTypesExpanded, setMoreTypesExpanded] = useState(false)
  const moreTypesId = useId()

  return (
    <div className="flex grow flex-col overflow-hidden">
      <div className="relative min-h-140 flex-1 overflow-hidden">
        <div
          className={cn(
            'pointer-events-none absolute inset-x-8 inset-y-2 grid-rows-4 gap-3',
            MAIN_NAV_APP_CARD_GRID_CLASS_NAME,
          )}
        >
          {EMPTY_PLACEHOLDER_CARD_IDS.map((id) => (
            <div key={id} className="rounded-xl bg-background-default-lighter opacity-75" />
          ))}
        </div>
        <div className="pointer-events-none absolute inset-0 bg-linear-to-b from-background-body/0 to-background-body" />
        <section
          className="absolute inset-0 flex items-center justify-center overflow-hidden p-2"
          aria-labelledby="apps-first-empty-title"
        >
          <div className="flex w-full max-w-130 flex-col items-center gap-6">
            <div className="flex flex-col items-center gap-3">
              <div className="flex size-14 items-center justify-center rounded-[10px]">
                <div className="flex size-full min-w-px items-center justify-center overflow-hidden rounded-xl border border-dashed border-divider-regular bg-components-card-bg p-1 backdrop-blur-md">
                  <span aria-hidden className="i-ri-robot-2-line size-6 text-text-tertiary" />
                </div>
              </div>
              <h2 id="apps-first-empty-title" className="system-xl-medium text-text-secondary">
                {t(($) => $['firstEmpty.title'], { ns: 'app' })}
              </h2>
            </div>
            <CreateAppCreationFlow onCreateTemplate={onCreateTemplate}>
              {({ onSelectType, disabled, loading }) => (
                <div className="flex w-full flex-col gap-4 rounded-xl p-2">
                  <div className="flex flex-col gap-1">
                    <FirstEmptyActionCard
                      description={t(($) => $['firstEmpty.templateDescription'], { ns: 'app' })}
                      icon={<span aria-hidden className="i-ri-function-line size-4" />}
                      onClick={onCreateTemplate}
                      stepByStepTourTarget={STEP_BY_STEP_TOUR_TARGETS.studioEmptyTemplate}
                      title={t(($) => $['newApp.menu.startFromTemplate'], { ns: 'app' })}
                      visualStyle="list"
                      className="rounded-lg shadow-none"
                    />
                    <FirstEmptyActionCard
                      description={t(($) => $['firstEmpty.importDescription'], { ns: 'app' })}
                      icon={<span aria-hidden className="i-ri-file-upload-line size-4" />}
                      onClick={onImportDSL}
                      stepByStepTourTarget={STEP_BY_STEP_TOUR_TARGETS.studioEmptyDSL}
                      title={t(($) => $['firstEmpty.importTitle'], { ns: 'app' })}
                      visualStyle="list"
                      className="rounded-lg shadow-none"
                    />
                  </div>
                  <div className="flex items-center gap-2 text-text-tertiary">
                    <span
                      aria-hidden
                      className="h-px min-w-0 flex-1 bg-linear-to-r from-transparent to-divider-regular"
                    />
                    <span className="system-xs-medium-uppercase">
                      {t(($) => $['firstEmpty.or'], { ns: 'app' })}
                    </span>
                    <span
                      aria-hidden
                      className="h-px min-w-0 flex-1 bg-linear-to-l from-transparent to-divider-regular"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="flex gap-2">
                      <FirstEmptyActionCard
                        description={t(($) => $['firstEmpty.workflowDescription'], { ns: 'app' })}
                        icon={<span aria-hidden className="i-ri-exchange-2-line size-4" />}
                        onClick={() => onSelectType('workflow')}
                        stepByStepTourTarget={STEP_BY_STEP_TOUR_TARGETS.studioEmptyWorkflow}
                        title={t(($) => $['types.workflow'], { ns: 'app' })}
                        visualStyle="list"
                        className="w-0 min-w-0 flex-1 rounded-lg shadow-none"
                      />
                      <FirstEmptyActionCard
                        description={t(($) => $['firstEmpty.chatflowDescription'], { ns: 'app' })}
                        icon={
                          <span
                            aria-hidden
                            className="i-custom-vender-line-app-types-chatflow size-4"
                          />
                        }
                        onClick={() => onSelectType('advanced-chat')}
                        title={t(($) => $['types.advanced'], { ns: 'app' })}
                        visualStyle="list"
                        className="w-0 min-w-0 flex-1 rounded-lg shadow-none"
                      />
                    </div>
                    <div>
                      <button
                        type="button"
                        aria-controls={moreTypesId}
                        aria-expanded={moreTypesExpanded}
                        className="flex h-6 w-full cursor-pointer items-center gap-1 rounded-lg py-1 text-left system-xs-medium-uppercase text-text-tertiary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
                        onClick={() => setMoreTypesExpanded((value) => !value)}
                      >
                        <span
                          aria-hidden
                          className={cn(
                            'i-ri-arrow-right-s-line size-4 transition-transform',
                            moreTypesExpanded && 'rotate-90',
                          )}
                        />
                        {t(($) => $['newApp.menu.moreTypes'], { ns: 'app' })}
                      </button>
                      <div
                        id={moreTypesId}
                        className={cn('mt-0.5 flex gap-1', !moreTypesExpanded && 'invisible')}
                      >
                        <Button
                          variant="tertiary"
                          className="min-w-0 flex-1 gap-0.5 bg-components-button-secondary-bg px-3 text-text-secondary"
                          disabled={disabled || loading}
                          onClick={() => onSelectType('agent-chat')}
                        >
                          <span
                            aria-hidden
                            className="i-custom-vender-line-app-types-agent-sparkle size-4 shrink-0 text-text-tertiary"
                          />
                          {t(($) => $['types.agent'], { ns: 'app' })}
                        </Button>
                        <Button
                          variant="tertiary"
                          className="min-w-0 flex-1 gap-0.5 bg-components-button-secondary-bg px-3 text-text-secondary"
                          disabled={disabled || loading}
                          onClick={() => onSelectType('completion')}
                        >
                          <span
                            aria-hidden
                            className="i-custom-vender-line-app-types-text-generator size-4 shrink-0 text-text-tertiary"
                          />
                          {t(($) => $['newApp.completeApp'], { ns: 'app' })}
                        </Button>
                        <Button
                          variant="tertiary"
                          className="min-w-0 flex-1 gap-0.5 bg-components-button-secondary-bg px-3 text-text-secondary"
                          disabled={disabled || loading}
                          onClick={() => onSelectType('chat')}
                        >
                          <span
                            aria-hidden
                            className="i-custom-vender-line-app-types-chatbot size-4 shrink-0 text-text-tertiary"
                          />
                          {t(($) => $['types.chatbot'], { ns: 'app' })}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </CreateAppCreationFlow>
          </div>
        </section>
      </div>
      {showLearnDify && (
        <div data-step-by-step-tour-target={STEP_BY_STEP_TOUR_TARGETS.studioEmptyLearnDify}>
          <LearnDify
            canCreate
            className="px-4 pt-2 pb-0 [&_div.grid]:gap-3 [&>div]:mx-0 [&>div]:rounded-t-2xl [&>div]:rounded-b-none [&>div]:px-5 [&>div]:pt-4 [&>div]:pb-5"
            dismissible={false}
            itemLimit={4}
            onCreate={onCreateLearnDify}
            onTry={onTryLearnDify}
            showDescription
            title={t(($) => $['firstEmpty.learnDifyTitle'], { ns: 'app' })}
          />
        </div>
      )}
    </div>
  )
}

export default FirstEmptyState
