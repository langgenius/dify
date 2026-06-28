import type { StepByStepTourGuideGroup, StepByStepTourTaskId } from './types'
import type { I18nKeysWithPrefix } from '@/types/i18n'

export const STEP_BY_STEP_TOUR_TARGETS = {
  home: 'step-by-step-tour-home',
  studio: 'step-by-step-tour-studio',
  studioEmptyTemplate: 'step-by-step-tour-studio-empty-template',
  studioEmptyBlank: 'step-by-step-tour-studio-empty-blank',
  studioEmptyDSL: 'step-by-step-tour-studio-empty-dsl',
  studioEmptyLearnDify: 'step-by-step-tour-studio-empty-learn-dify',
  studioWithAppsCreate: 'step-by-step-tour-studio-with-apps-create',
  studioWithAppsCreateMenu: 'step-by-step-tour-studio-with-apps-create-menu',
  studioWithAppsFirstAppCard: 'step-by-step-tour-studio-with-apps-first-app-card',
  studioWithAppsFirstAppCardActionsMenu: 'step-by-step-tour-studio-with-apps-first-app-card-actions-menu',
  knowledge: 'step-by-step-tour-knowledge',
  integration: 'step-by-step-tour-integration',
} as const

type StepByStepTourGuideCopyKey = I18nKeysWithPrefix<'common', 'stepByStepTour.'>

export type StepByStepTourGuide = {
  taskId: StepByStepTourTaskId
  target: string
  title: StepByStepTourGuideCopyKey
  description: StepByStepTourGuideCopyKey
  learnMoreLabel: StepByStepTourGuideCopyKey
  primaryActionLabel: StepByStepTourGuideCopyKey
  highlightPartSelectors?: string[]
  optional?: boolean
}

export const STEP_BY_STEP_TOUR_STUDIO_GUIDES: Record<StepByStepTourGuideGroup, StepByStepTourGuide[]> = {
  studioEmpty: [
    {
      taskId: 'studio',
      target: STEP_BY_STEP_TOUR_TARGETS.studioEmptyTemplate,
      title: 'stepByStepTour.guides.studio.empty.template.title',
      description: 'stepByStepTour.guides.studio.empty.template.description',
      learnMoreLabel: 'stepByStepTour.learnMore',
      primaryActionLabel: 'stepByStepTour.guides.primaryActionLabel',
    },
    {
      taskId: 'studio',
      target: STEP_BY_STEP_TOUR_TARGETS.studioEmptyBlank,
      title: 'stepByStepTour.guides.studio.empty.blank.title',
      description: 'stepByStepTour.guides.studio.empty.blank.description',
      learnMoreLabel: 'stepByStepTour.learnMore',
      primaryActionLabel: 'stepByStepTour.guides.primaryActionLabel',
    },
    {
      taskId: 'studio',
      target: STEP_BY_STEP_TOUR_TARGETS.studioEmptyDSL,
      title: 'stepByStepTour.guides.studio.empty.dsl.title',
      description: 'stepByStepTour.guides.studio.empty.dsl.description',
      learnMoreLabel: 'stepByStepTour.learnMore',
      primaryActionLabel: 'stepByStepTour.guides.primaryActionLabel',
    },
    {
      taskId: 'studio',
      target: STEP_BY_STEP_TOUR_TARGETS.studioEmptyLearnDify,
      title: 'stepByStepTour.guides.studio.empty.learnDify.title',
      description: 'stepByStepTour.guides.studio.empty.learnDify.description',
      learnMoreLabel: 'stepByStepTour.learnMore',
      primaryActionLabel: 'stepByStepTour.guides.primaryActionLabel',
      optional: true,
    },
  ],
  studioWithApps: [
    {
      taskId: 'studio',
      target: STEP_BY_STEP_TOUR_TARGETS.studioWithAppsCreate,
      title: 'stepByStepTour.guides.studio.withApps.create.title',
      description: 'stepByStepTour.guides.studio.withApps.create.description',
      learnMoreLabel: 'stepByStepTour.learnMore',
      primaryActionLabel: 'stepByStepTour.guides.primaryActionLabel',
      highlightPartSelectors: [
        getStepByStepTourHighlightPartSelector(STEP_BY_STEP_TOUR_TARGETS.studioWithAppsCreateMenu),
      ],
    },
    {
      taskId: 'studio',
      target: STEP_BY_STEP_TOUR_TARGETS.studioWithAppsFirstAppCard,
      title: 'stepByStepTour.guides.studio.withApps.manage.title',
      description: 'stepByStepTour.guides.studio.withApps.manage.description',
      learnMoreLabel: 'stepByStepTour.learnMore',
      primaryActionLabel: 'stepByStepTour.guides.primaryActionLabel',
      highlightPartSelectors: [
        getStepByStepTourHighlightPartSelector(STEP_BY_STEP_TOUR_TARGETS.studioWithAppsFirstAppCardActionsMenu),
      ],
      optional: true,
    },
  ],
}

export const STEP_BY_STEP_TOUR_GUIDES: Partial<Record<StepByStepTourTaskId, StepByStepTourGuide[]>> = {
  home: [
    {
      taskId: 'home',
      target: STEP_BY_STEP_TOUR_TARGETS.home,
      title: 'stepByStepTour.tasks.home.title',
      description: 'stepByStepTour.tasks.home.description',
      learnMoreLabel: 'stepByStepTour.learnMore',
      primaryActionLabel: 'stepByStepTour.tasks.home.primaryActionLabel',
    },
  ],
  integration: [
    {
      taskId: 'integration',
      target: STEP_BY_STEP_TOUR_TARGETS.integration,
      title: 'stepByStepTour.guides.integration.autoUpdate.title',
      description: 'stepByStepTour.guides.integration.autoUpdate.description',
      learnMoreLabel: 'stepByStepTour.learnMore',
      primaryActionLabel: 'stepByStepTour.guides.primaryActionLabel',
    },
  ],
}

export const getStepByStepTourGuides = (
  taskId: StepByStepTourTaskId,
  guideGroup?: StepByStepTourGuideGroup,
) => {
  if (taskId === 'studio')
    return guideGroup ? STEP_BY_STEP_TOUR_STUDIO_GUIDES[guideGroup] : []

  return STEP_BY_STEP_TOUR_GUIDES[taskId] ?? []
}

export function getStepByStepTourTargetSelector(target: string) {
  return `[data-step-by-step-tour-target="${target}"]`
}

export function getStepByStepTourHighlightPartSelector(target: string) {
  return `[data-step-by-step-tour-highlight-part="${target}"]`
}
