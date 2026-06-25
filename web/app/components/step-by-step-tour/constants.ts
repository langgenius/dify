import type { StepByStepTourAccountState, StepByStepTourTaskDefinition } from './types'
import { buildIntegrationPath } from '@/app/components/integrations/routes'

export const STEP_BY_STEP_TOUR_STORAGE_KEY = 'step-by-step-tour-account-state'

export const STEP_BY_STEP_TOUR_TARGETS = {
  home: 'step-by-step-tour-home',
  studio: 'step-by-step-tour-studio',
  knowledge: 'step-by-step-tour-knowledge',
  integration: 'step-by-step-tour-integration',
} as const

export const STEP_BY_STEP_TOUR_TASKS = [
  {
    id: 'home',
    route: '/',
    target: STEP_BY_STEP_TOUR_TARGETS.home,
    fallbackTarget: STEP_BY_STEP_TOUR_TARGETS.home,
    canClickThrough: true,
  },
  {
    id: 'studio',
    route: '/apps',
    target: STEP_BY_STEP_TOUR_TARGETS.studio,
    fallbackTarget: STEP_BY_STEP_TOUR_TARGETS.studio,
    canClickThrough: true,
  },
  {
    id: 'knowledge',
    route: '/datasets',
    target: STEP_BY_STEP_TOUR_TARGETS.knowledge,
    fallbackTarget: STEP_BY_STEP_TOUR_TARGETS.knowledge,
    canClickThrough: true,
    permissionFallback: 'show-disabled-reason',
  },
  {
    id: 'integration',
    route: buildIntegrationPath('provider'),
    target: STEP_BY_STEP_TOUR_TARGETS.integration,
    fallbackTarget: STEP_BY_STEP_TOUR_TARGETS.integration,
    canClickThrough: true,
    permissionFallback: 'show-disabled-reason',
  },
] as const satisfies readonly StepByStepTourTaskDefinition[]

export const createDefaultStepByStepTourAccountState = (): StepByStepTourAccountState => ({
  manuallyEnabledWorkspaceIds: [],
  manuallyDisabledWorkspaceIds: [],
  minimized: false,
  completedTaskIds: [],
  skipped: false,
})
