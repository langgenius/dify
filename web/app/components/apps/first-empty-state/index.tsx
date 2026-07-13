'use client'

import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import LearnDify from '@/app/components/explore/learn-dify'
import { STEP_BY_STEP_TOUR_TARGETS } from '@/app/components/step-by-step-tour/target-registry'
import FirstEmptyActionCard from './action-card'

const EMPTY_PLACEHOLDER_CARD_IDS = Array.from(
  { length: 16 },
  (_, index) => `placeholder-card-${index}`,
)

type EmptyCreateAction = {
  id: string
  icon: ReactNode
  title: string
  description: string
  target: string
  onClick: () => void
}

type Props = {
  onCreateBlank: () => void
  onCreateTemplate: () => void
  onImportDSL: () => void
  showLearnDify: boolean
}

function FirstEmptyState({ onCreateBlank, onCreateTemplate, onImportDSL, showLearnDify }: Props) {
  const { t } = useTranslation()

  const actions: EmptyCreateAction[] = [
    {
      id: 'template',
      icon: <span aria-hidden className="i-ri-function-add-line size-4" />,
      title: t(($) => $['newApp.startFromTemplate'], { ns: 'app' }),
      description: t(($) => $['firstEmpty.templateDescription'], { ns: 'app' }),
      onClick: onCreateTemplate,
      target: STEP_BY_STEP_TOUR_TARGETS.studioEmptyTemplate,
    },
    {
      id: 'blank',
      icon: <span aria-hidden className="i-ri-add-box-line size-4" />,
      title: t(($) => $['newApp.startFromBlank'], { ns: 'app' }),
      description: t(($) => $['firstEmpty.blankDescription'], { ns: 'app' }),
      onClick: onCreateBlank,
      target: STEP_BY_STEP_TOUR_TARGETS.studioEmptyBlank,
    },
    {
      id: 'dsl',
      icon: <span aria-hidden className="i-ri-file-upload-line size-4" />,
      title: t(($) => $.importDSL, { ns: 'app' }),
      description: t(($) => $['firstEmpty.importDescription'], { ns: 'app' }),
      onClick: onImportDSL,
      target: STEP_BY_STEP_TOUR_TARGETS.studioEmptyDSL,
    },
  ]

  return (
    <div className="flex grow flex-col overflow-hidden">
      <div className="relative min-h-[430px] flex-1 overflow-hidden">
        <div className="pointer-events-none absolute inset-x-8 inset-y-2 grid grid-cols-[repeat(auto-fill,minmax(296px,1fr))] grid-rows-4 gap-3">
          {EMPTY_PLACEHOLDER_CARD_IDS.map((id) => (
            <div key={id} className="rounded-xl bg-background-default-lighter opacity-75" />
          ))}
        </div>
        <div className="pointer-events-none absolute inset-0 bg-linear-to-b from-background-body/0 to-background-body" />
        <section
          className="absolute inset-0 flex items-center justify-center overflow-hidden p-2"
          aria-labelledby="apps-first-empty-title"
        >
          <div className="flex w-full max-w-[520px] flex-col items-center gap-6">
            <div className="flex flex-col items-center gap-3">
              <div className="flex size-14 items-center justify-center rounded-[10px]">
                <div className="flex size-full min-w-px items-center justify-center overflow-hidden rounded-xl border border-dashed border-divider-regular bg-components-card-bg p-1 backdrop-blur-md">
                  <span aria-hidden className="i-ri-robot-2-line size-6 text-text-tertiary" />
                </div>
              </div>
              <h2 id="apps-first-empty-title" className="system-sm-regular text-text-tertiary">
                {t(($) => $['firstEmpty.title'], { ns: 'app' })}
              </h2>
            </div>
            <div className="flex w-full flex-col gap-2">
              <div className="flex flex-col gap-2">
                {actions.slice(0, 2).map((action) => (
                  <FirstEmptyActionCard
                    key={action.id}
                    description={action.description}
                    icon={action.icon}
                    onClick={action.onClick}
                    stepByStepTourTarget={action.target}
                    title={action.title}
                    visualStyle="list"
                  />
                ))}
              </div>
              <div className="flex items-center gap-2 text-text-tertiary">
                <div className="h-px min-w-0 flex-1 bg-linear-to-r from-background-body/0 to-divider-regular" />
                <span className="system-xs-medium-uppercase uppercase">
                  {t(($) => $['firstEmpty.or'], { ns: 'app' })}
                </span>
                <div className="h-px min-w-0 flex-1 bg-linear-to-r from-divider-regular to-background-body/0" />
              </div>
              <FirstEmptyActionCard
                description={actions[2]!.description}
                icon={actions[2]!.icon}
                onClick={actions[2]!.onClick}
                stepByStepTourTarget={actions[2]!.target}
                title={actions[2]!.title}
                visualStyle="list"
              />
            </div>
          </div>
        </section>
      </div>
      {showLearnDify && (
        <div data-step-by-step-tour-target={STEP_BY_STEP_TOUR_TARGETS.studioEmptyLearnDify}>
          <LearnDify
            className="px-4 pt-2 pb-0 [&_div.grid]:gap-3 [&>div]:mx-0 [&>div]:rounded-t-2xl [&>div]:rounded-b-none [&>div]:px-5 [&>div]:pt-4 [&>div]:pb-5"
            dismissible={false}
            itemLimit={4}
            showDescription
            title={t(($) => $['firstEmpty.learnDifyTitle'], { ns: 'app' })}
          />
        </div>
      )}
    </div>
  )
}

export default FirstEmptyState
