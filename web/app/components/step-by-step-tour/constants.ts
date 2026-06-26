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
    iconClassName: 'i-custom-vender-line-education-book-open-01',
    fallbackTarget: STEP_BY_STEP_TOUR_TARGETS.home,
    learnMoreDocPath: '/use-dify/getting-started/introduction',
    canClickThrough: true,
  },
  {
    id: 'studio',
    route: '/apps',
    target: STEP_BY_STEP_TOUR_TARGETS.studio,
    iconClassName: 'i-custom-vender-main-nav-studio',
    fallbackTarget: STEP_BY_STEP_TOUR_TARGETS.studio,
    learnMoreDocPath: '/use-dify/workspace/app-management',
    canClickThrough: true,
  },
  {
    id: 'knowledge',
    route: '/datasets',
    target: STEP_BY_STEP_TOUR_TARGETS.knowledge,
    iconClassName: 'i-custom-vender-main-nav-knowledge',
    fallbackTarget: STEP_BY_STEP_TOUR_TARGETS.knowledge,
    learnMoreDocPath: '/use-dify/knowledge/create-knowledge/introduction',
    canClickThrough: true,
    permissionFallback: 'show-disabled-reason',
  },
  {
    id: 'integration',
    route: buildIntegrationPath('provider'),
    target: STEP_BY_STEP_TOUR_TARGETS.integration,
    iconClassName: 'i-custom-vender-main-nav-integrations',
    fallbackTarget: STEP_BY_STEP_TOUR_TARGETS.integration,
    learnMoreDocPath: '/use-dify/workspace/plugins',
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
