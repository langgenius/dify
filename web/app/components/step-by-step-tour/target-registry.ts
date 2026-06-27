import type { StepByStepTourTaskId } from './types'

export const STEP_BY_STEP_TOUR_TARGETS = {
  home: 'step-by-step-tour-home',
  studio: 'step-by-step-tour-studio',
  knowledge: 'step-by-step-tour-knowledge',
  integration: 'step-by-step-tour-integration',
} as const

export type StepByStepTourGuide = {
  taskId: StepByStepTourTaskId
  target: string
  title: string
  description: string
  learnMoreLabel: string
  primaryActionLabel: string
}

export const STEP_BY_STEP_TOUR_GUIDES: Partial<Record<StepByStepTourTaskId, StepByStepTourGuide>> = {
  integration: {
    taskId: 'integration',
    target: STEP_BY_STEP_TOUR_TARGETS.integration,
    title: 'Keep tools up to date',
    description: 'Turn on Auto-update so installed tool plugins stay on the latest version automatically.',
    learnMoreLabel: 'Learn more',
    primaryActionLabel: 'Got it',
  },
}

export const getStepByStepTourTargetSelector = (target: string) =>
  `[data-step-by-step-tour-target="${target}"]`
