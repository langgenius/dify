import type { StepByStepTourGuideGroup, StepByStepTourTaskId } from './types'
import type { IntegrationSection } from '@/app/components/integrations/routes'
import type { DocPathWithoutLang } from '@/types/doc-paths'
import type { I18nKeysWithPrefix } from '@/types/i18n'

export const STEP_BY_STEP_TOUR_TARGETS = {
  home: 'step-by-step-tour-home',
  homeTryAppCreate: 'step-by-step-tour-home-try-app-create',
  studio: 'step-by-step-tour-studio',
  studioEmptyTemplate: 'step-by-step-tour-studio-empty-template',
  studioEmptyBlank: 'step-by-step-tour-studio-empty-blank',
  studioEmptyDSL: 'step-by-step-tour-studio-empty-dsl',
  studioEmptyLearnDify: 'step-by-step-tour-studio-empty-learn-dify',
  studioWithAppsCreate: 'step-by-step-tour-studio-with-apps-create',
  studioWithAppsCreateMenu: 'step-by-step-tour-studio-with-apps-create-menu',
  studioWithAppsFirstAppCard: 'step-by-step-tour-studio-with-apps-first-app-card',
  studioWithAppsFirstAppCardActionsMenu:
    'step-by-step-tour-studio-with-apps-first-app-card-actions-menu',
  studioNoCreateEmpty: 'step-by-step-tour-studio-no-create-empty',
  studioNoCreateFirstAppCard: 'step-by-step-tour-studio-no-create-first-app-card',
  studioNoCreateFirstAppRowCard: 'step-by-step-tour-studio-no-create-first-app-row-card',
  knowledge: 'step-by-step-tour-knowledge',
  knowledgeEmptyCreate: 'step-by-step-tour-knowledge-empty-create',
  knowledgeEmptyPipeline: 'step-by-step-tour-knowledge-empty-pipeline',
  knowledgeEmptyConnect: 'step-by-step-tour-knowledge-empty-connect',
  knowledgeWithDatasetsCreate: 'step-by-step-tour-knowledge-with-datasets-create',
  knowledgeWithDatasetsCreateMenu: 'step-by-step-tour-knowledge-with-datasets-create-menu',
  knowledgeWithDatasetsFirstCard: 'step-by-step-tour-knowledge-with-datasets-first-card',
  knowledgeWithDatasetsFirstCardActionsMenu:
    'step-by-step-tour-knowledge-with-datasets-first-card-actions-menu',
  integration: 'step-by-step-tour-integration',
  integrationModelProviderNav: 'step-by-step-tour-integration-model-provider-nav',
  integrationToolPluginNav: 'step-by-step-tour-integration-tool-plugin-nav',
  integrationMcpNav: 'step-by-step-tour-integration-mcp-nav',
  integrationDataSourceNav: 'step-by-step-tour-integration-data-source-nav',
  integrationTriggerNav: 'step-by-step-tour-integration-trigger-nav',
  integrationUpdateSettings: 'step-by-step-tour-integration-update-settings',
  integrationModelProviderCredits: 'step-by-step-tour-integration-model-provider-credits',
  integrationModelProviderProduction: 'step-by-step-tour-integration-model-provider-production',
  integrationModelProviderInstall: 'step-by-step-tour-integration-model-provider-install',
  integrationToolPluginAutoUpdate: 'step-by-step-tour-integration-tool-plugin-auto-update',
  integrationToolPluginFirstCard: 'step-by-step-tour-integration-tool-plugin-first-card',
  integrationMcpAdd: 'step-by-step-tour-integration-mcp-add',
  integrationMcpFirstCard: 'step-by-step-tour-integration-mcp-first-card',
  integrationWorkflowToolGrid: 'step-by-step-tour-integration-workflow-tool-grid',
  integrationSwaggerToolGrid: 'step-by-step-tour-integration-swagger-tool-grid',
  integrationDataSourceFirstCard: 'step-by-step-tour-integration-data-source-first-card',
  integrationTriggerGrid: 'step-by-step-tour-integration-trigger-grid',
  integrationAgentStrategyEmpty: 'step-by-step-tour-integration-agent-strategy-empty',
  integrationExtensionGrid: 'step-by-step-tour-integration-extension-grid',
  integrationCustomEndpointEmpty: 'step-by-step-tour-integration-custom-endpoint-empty',
} as const

type StepByStepTourGuideCopyKey = I18nKeysWithPrefix<'common', 'stepByStepTour.'>

export type StepByStepTourGuideKind = 'action' | 'walkthrough'

export type StepByStepTourGuideInteractionPolicy = 'blocked' | 'target-only'

type StepByStepTourGuidePortalOrder = 'afterOverlays'

export type StepByStepTourGuide = {
  taskId: StepByStepTourTaskId
  target: string
  title: StepByStepTourGuideCopyKey
  description: StepByStepTourGuideCopyKey
  learnMoreLabel: StepByStepTourGuideCopyKey
  primaryActionLabel: StepByStepTourGuideCopyKey
  completionMode?: 'guideAction' | 'external'
  kind?: StepByStepTourGuideKind
  interactionPolicy?: StepByStepTourGuideInteractionPolicy
  highlightPartSelectors?: string[]
  integrationSection?: IntegrationSection
  learnMoreDocPath?: DocPathWithoutLang
  optional?: boolean
  portalOrder?: StepByStepTourGuidePortalOrder
}

export function getStepByStepTourGuideKind(
  guide: Pick<StepByStepTourGuide, 'completionMode' | 'kind'>,
): StepByStepTourGuideKind {
  return guide.kind ?? (guide.completionMode === 'external' ? 'action' : 'walkthrough')
}

export function getStepByStepTourGuideInteractionPolicy(
  guide: StepByStepTourGuide,
  canClickThrough: boolean,
): StepByStepTourGuideInteractionPolicy {
  if (guide.interactionPolicy) return guide.interactionPolicy

  if (getStepByStepTourGuideKind(guide) === 'action')
    return canClickThrough ? 'target-only' : 'blocked'

  return 'blocked'
}

const STEP_BY_STEP_TOUR_STUDIO_GUIDES: Record<
  Extract<
    StepByStepTourGuideGroup,
    'studioEmpty' | 'studioWithApps' | 'studioNoCreateEmpty' | 'studioNoCreateWithApps'
  >,
  StepByStepTourGuide[]
> = {
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
        getStepByStepTourHighlightPartSelector(
          STEP_BY_STEP_TOUR_TARGETS.studioWithAppsFirstAppCardActionsMenu,
        ),
      ],
      optional: true,
    },
  ],
  studioNoCreateEmpty: [
    {
      taskId: 'studio',
      target: STEP_BY_STEP_TOUR_TARGETS.studioNoCreateEmpty,
      title: 'stepByStepTour.guides.studio.noCreate.empty.title',
      description: 'stepByStepTour.guides.studio.noCreate.empty.description',
      learnMoreLabel: 'stepByStepTour.learnMore',
      primaryActionLabel: 'stepByStepTour.guides.primaryActionLabel',
    },
  ],
  studioNoCreateWithApps: [
    {
      taskId: 'studio',
      target: STEP_BY_STEP_TOUR_TARGETS.studioNoCreateFirstAppCard,
      title: 'stepByStepTour.guides.studio.noCreate.withApps.title',
      description: 'stepByStepTour.guides.studio.noCreate.withApps.description',
      learnMoreLabel: 'stepByStepTour.learnMore',
      primaryActionLabel: 'stepByStepTour.guides.primaryActionLabel',
      highlightPartSelectors: [
        getStepByStepTourHighlightPartSelector(
          STEP_BY_STEP_TOUR_TARGETS.studioNoCreateFirstAppRowCard,
        ),
      ],
    },
  ],
}

const STEP_BY_STEP_TOUR_KNOWLEDGE_GUIDES: Record<
  Extract<StepByStepTourGuideGroup, 'knowledgeEmpty' | 'knowledgeWithDatasets'>,
  StepByStepTourGuide[]
> = {
  knowledgeEmpty: [
    {
      taskId: 'knowledge',
      target: STEP_BY_STEP_TOUR_TARGETS.knowledgeEmptyCreate,
      title: 'stepByStepTour.guides.knowledge.empty.create.title',
      description: 'stepByStepTour.guides.knowledge.empty.create.description',
      learnMoreLabel: 'stepByStepTour.learnMore',
      primaryActionLabel: 'stepByStepTour.guides.primaryActionLabel',
    },
    {
      taskId: 'knowledge',
      target: STEP_BY_STEP_TOUR_TARGETS.knowledgeEmptyPipeline,
      title: 'stepByStepTour.guides.knowledge.empty.pipeline.title',
      description: 'stepByStepTour.guides.knowledge.empty.pipeline.description',
      learnMoreLabel: 'stepByStepTour.learnMore',
      primaryActionLabel: 'stepByStepTour.guides.primaryActionLabel',
    },
    {
      taskId: 'knowledge',
      target: STEP_BY_STEP_TOUR_TARGETS.knowledgeEmptyConnect,
      title: 'stepByStepTour.guides.knowledge.empty.connect.title',
      description: 'stepByStepTour.guides.knowledge.empty.connect.description',
      learnMoreLabel: 'stepByStepTour.learnMore',
      primaryActionLabel: 'stepByStepTour.guides.primaryActionLabel',
    },
  ],
  knowledgeWithDatasets: [
    {
      taskId: 'knowledge',
      target: STEP_BY_STEP_TOUR_TARGETS.knowledgeWithDatasetsCreate,
      title: 'stepByStepTour.guides.knowledge.withDatasets.create.title',
      description: 'stepByStepTour.guides.knowledge.withDatasets.create.description',
      learnMoreLabel: 'stepByStepTour.learnMore',
      primaryActionLabel: 'stepByStepTour.guides.primaryActionLabel',
      highlightPartSelectors: [
        getStepByStepTourHighlightPartSelector(
          STEP_BY_STEP_TOUR_TARGETS.knowledgeWithDatasetsCreateMenu,
        ),
      ],
    },
    {
      taskId: 'knowledge',
      target: STEP_BY_STEP_TOUR_TARGETS.knowledgeWithDatasetsFirstCard,
      title: 'stepByStepTour.guides.knowledge.withDatasets.manage.title',
      description: 'stepByStepTour.guides.knowledge.withDatasets.manage.description',
      learnMoreLabel: 'stepByStepTour.learnMore',
      primaryActionLabel: 'stepByStepTour.guides.primaryActionLabel',
      highlightPartSelectors: [
        getStepByStepTourHighlightPartSelector(
          STEP_BY_STEP_TOUR_TARGETS.knowledgeWithDatasetsFirstCardActionsMenu,
        ),
      ],
      optional: true,
    },
  ],
}

const STEP_BY_STEP_TOUR_GUIDES: Partial<Record<StepByStepTourTaskId, StepByStepTourGuide[]>> = {
  home: [
    {
      taskId: 'home',
      target: STEP_BY_STEP_TOUR_TARGETS.home,
      title: 'stepByStepTour.tasks.home.title',
      description: 'stepByStepTour.guides.home.pick.description',
      learnMoreLabel: 'stepByStepTour.learnMore',
      primaryActionLabel: 'stepByStepTour.tasks.home.primaryActionLabel',
      completionMode: 'external',
      kind: 'action',
      interactionPolicy: 'target-only',
    },
    {
      taskId: 'home',
      target: STEP_BY_STEP_TOUR_TARGETS.homeTryAppCreate,
      title: 'stepByStepTour.tasks.home.title',
      description: 'stepByStepTour.guides.home.create.description',
      learnMoreLabel: 'stepByStepTour.learnMore',
      primaryActionLabel: 'stepByStepTour.guides.primaryActionLabel',
      completionMode: 'external',
      kind: 'action',
      interactionPolicy: 'target-only',
      portalOrder: 'afterOverlays',
    },
  ],
  integration: [
    {
      taskId: 'integration',
      target: STEP_BY_STEP_TOUR_TARGETS.integrationModelProviderNav,
      title: 'stepByStepTour.guides.integration.modelProvider.title',
      description: 'stepByStepTour.guides.integration.modelProvider.description',
      learnMoreLabel: 'stepByStepTour.learnMore',
      primaryActionLabel: 'stepByStepTour.guides.primaryActionLabel',
      integrationSection: 'provider',
    },
    {
      taskId: 'integration',
      target: STEP_BY_STEP_TOUR_TARGETS.integrationToolPluginNav,
      title: 'stepByStepTour.guides.integration.toolPlugin.title',
      description: 'stepByStepTour.guides.integration.toolPlugin.description',
      learnMoreLabel: 'stepByStepTour.learnMore',
      primaryActionLabel: 'stepByStepTour.guides.primaryActionLabel',
      integrationSection: 'builtin',
    },
    {
      taskId: 'integration',
      target: STEP_BY_STEP_TOUR_TARGETS.integrationMcpNav,
      title: 'stepByStepTour.guides.integration.mcp.title',
      description: 'stepByStepTour.guides.integration.mcp.description',
      learnMoreLabel: 'stepByStepTour.learnMore',
      primaryActionLabel: 'stepByStepTour.guides.primaryActionLabel',
      integrationSection: 'mcp',
    },
    {
      taskId: 'integration',
      target: STEP_BY_STEP_TOUR_TARGETS.integrationDataSourceNav,
      title: 'stepByStepTour.guides.integration.dataSource.title',
      description: 'stepByStepTour.guides.integration.dataSource.description',
      learnMoreLabel: 'stepByStepTour.learnMore',
      primaryActionLabel: 'stepByStepTour.guides.primaryActionLabel',
      integrationSection: 'data-source',
    },
    {
      taskId: 'integration',
      target: STEP_BY_STEP_TOUR_TARGETS.integrationTriggerNav,
      title: 'stepByStepTour.guides.integration.trigger.title',
      description: 'stepByStepTour.guides.integration.trigger.description',
      learnMoreLabel: 'stepByStepTour.learnMore',
      primaryActionLabel: 'stepByStepTour.guides.primaryActionLabel',
      integrationSection: 'trigger',
    },
    {
      taskId: 'integration',
      target: STEP_BY_STEP_TOUR_TARGETS.integrationUpdateSettings,
      title: 'stepByStepTour.guides.integration.updateSettings.title',
      description: 'stepByStepTour.guides.integration.updateSettings.description',
      learnMoreLabel: 'stepByStepTour.learnMore',
      primaryActionLabel: 'stepByStepTour.guides.primaryActionLabel',
      integrationSection: 'builtin',
      optional: true,
    },
  ],
}

const STEP_BY_STEP_TOUR_HOME_NO_CREATE_GUIDES: StepByStepTourGuide[] = [
  {
    taskId: 'home',
    target: STEP_BY_STEP_TOUR_TARGETS.home,
    title: 'stepByStepTour.guides.home.noCreate.title',
    description: 'stepByStepTour.guides.home.noCreate.description',
    learnMoreLabel: 'stepByStepTour.learnMore',
    primaryActionLabel: 'stepByStepTour.guides.primaryActionLabel',
  },
]

const STEP_BY_STEP_TOUR_INTEGRATION_LIMITED_ACCESS_GUIDES: StepByStepTourGuide[] = [
  {
    taskId: 'integration',
    target: STEP_BY_STEP_TOUR_TARGETS.integrationModelProviderNav,
    title: 'stepByStepTour.guides.integration.modelProvider.title',
    description: 'stepByStepTour.guides.integration.limitedAccess.modelProvider.description',
    learnMoreLabel: 'stepByStepTour.learnMore',
    primaryActionLabel: 'stepByStepTour.guides.primaryActionLabel',
    integrationSection: 'provider',
  },
  {
    taskId: 'integration',
    target: STEP_BY_STEP_TOUR_TARGETS.integrationToolPluginNav,
    title: 'stepByStepTour.guides.integration.toolPlugin.title',
    description: 'stepByStepTour.guides.integration.limitedAccess.toolPlugin.description',
    learnMoreLabel: 'stepByStepTour.learnMore',
    primaryActionLabel: 'stepByStepTour.guides.primaryActionLabel',
    integrationSection: 'builtin',
  },
  {
    taskId: 'integration',
    target: STEP_BY_STEP_TOUR_TARGETS.integrationMcpNav,
    title: 'stepByStepTour.guides.integration.mcp.title',
    description: 'stepByStepTour.guides.integration.limitedAccess.mcp.description',
    learnMoreLabel: 'stepByStepTour.learnMore',
    primaryActionLabel: 'stepByStepTour.guides.primaryActionLabel',
    integrationSection: 'mcp',
  },
  {
    taskId: 'integration',
    target: STEP_BY_STEP_TOUR_TARGETS.integrationDataSourceNav,
    title: 'stepByStepTour.guides.integration.dataSource.title',
    description: 'stepByStepTour.guides.integration.limitedAccess.dataSource.description',
    learnMoreLabel: 'stepByStepTour.learnMore',
    primaryActionLabel: 'stepByStepTour.guides.primaryActionLabel',
    integrationSection: 'data-source',
  },
  {
    taskId: 'integration',
    target: STEP_BY_STEP_TOUR_TARGETS.integrationTriggerNav,
    title: 'stepByStepTour.guides.integration.trigger.title',
    description: 'stepByStepTour.guides.integration.limitedAccess.trigger.description',
    learnMoreLabel: 'stepByStepTour.learnMore',
    primaryActionLabel: 'stepByStepTour.guides.primaryActionLabel',
    integrationSection: 'trigger',
  },
]

const isStepByStepTourHomeGuideGroup = (
  guideGroup?: StepByStepTourGuideGroup,
): guideGroup is Extract<StepByStepTourGuideGroup, 'homeNoCreate'> => guideGroup === 'homeNoCreate'

const isStepByStepTourStudioGuideGroup = (
  guideGroup?: StepByStepTourGuideGroup,
): guideGroup is Extract<
  StepByStepTourGuideGroup,
  'studioEmpty' | 'studioWithApps' | 'studioNoCreateEmpty' | 'studioNoCreateWithApps'
> =>
  guideGroup === 'studioEmpty' ||
  guideGroup === 'studioWithApps' ||
  guideGroup === 'studioNoCreateEmpty' ||
  guideGroup === 'studioNoCreateWithApps'

const isStepByStepTourKnowledgeGuideGroup = (
  guideGroup?: StepByStepTourGuideGroup,
): guideGroup is Extract<StepByStepTourGuideGroup, 'knowledgeEmpty' | 'knowledgeWithDatasets'> =>
  guideGroup === 'knowledgeEmpty' || guideGroup === 'knowledgeWithDatasets'

const isStepByStepTourIntegrationGuideGroup = (
  guideGroup?: StepByStepTourGuideGroup,
): guideGroup is Extract<StepByStepTourGuideGroup, 'integrationLimitedAccess'> =>
  guideGroup === 'integrationLimitedAccess'

export const getStepByStepTourGuides = (
  taskId: StepByStepTourTaskId,
  guideGroup?: StepByStepTourGuideGroup,
) => {
  if (taskId === 'home' && isStepByStepTourHomeGuideGroup(guideGroup))
    return STEP_BY_STEP_TOUR_HOME_NO_CREATE_GUIDES

  if (taskId === 'studio')
    return isStepByStepTourStudioGuideGroup(guideGroup)
      ? STEP_BY_STEP_TOUR_STUDIO_GUIDES[guideGroup]
      : []

  if (taskId === 'knowledge')
    return isStepByStepTourKnowledgeGuideGroup(guideGroup)
      ? STEP_BY_STEP_TOUR_KNOWLEDGE_GUIDES[guideGroup]
      : []

  if (taskId === 'integration' && isStepByStepTourIntegrationGuideGroup(guideGroup))
    return STEP_BY_STEP_TOUR_INTEGRATION_LIMITED_ACCESS_GUIDES

  return STEP_BY_STEP_TOUR_GUIDES[taskId] ?? []
}

export function getStepByStepTourTargetSelector(target: string) {
  return `[data-step-by-step-tour-target="${target}"]`
}

function getStepByStepTourHighlightPartSelector(target: string) {
  return `[data-step-by-step-tour-highlight-part="${target}"]`
}
