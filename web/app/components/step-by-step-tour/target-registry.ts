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
  studioWithAppsFirstAppCardActionsMenu: 'step-by-step-tour-studio-with-apps-first-app-card-actions-menu',
  knowledge: 'step-by-step-tour-knowledge',
  knowledgeEmptyCreate: 'step-by-step-tour-knowledge-empty-create',
  knowledgeEmptyPipeline: 'step-by-step-tour-knowledge-empty-pipeline',
  knowledgeEmptyConnect: 'step-by-step-tour-knowledge-empty-connect',
  knowledgeWithDatasetsCreate: 'step-by-step-tour-knowledge-with-datasets-create',
  knowledgeWithDatasetsCreateMenu: 'step-by-step-tour-knowledge-with-datasets-create-menu',
  knowledgeWithDatasetsFirstCard: 'step-by-step-tour-knowledge-with-datasets-first-card',
  knowledgeWithDatasetsFirstCardActionsMenu: 'step-by-step-tour-knowledge-with-datasets-first-card-actions-menu',
  integration: 'step-by-step-tour-integration',
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
  if (guide.interactionPolicy)
    return guide.interactionPolicy

  if (getStepByStepTourGuideKind(guide) === 'action')
    return canClickThrough ? 'target-only' : 'blocked'

  return 'blocked'
}

export const STEP_BY_STEP_TOUR_STUDIO_GUIDES: Record<Extract<StepByStepTourGuideGroup, 'studioEmpty' | 'studioWithApps'>, StepByStepTourGuide[]> = {
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

export const STEP_BY_STEP_TOUR_KNOWLEDGE_GUIDES: Record<Extract<StepByStepTourGuideGroup, 'knowledgeEmpty' | 'knowledgeWithDatasets'>, StepByStepTourGuide[]> = {
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
        getStepByStepTourHighlightPartSelector(STEP_BY_STEP_TOUR_TARGETS.knowledgeWithDatasetsCreateMenu),
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
        getStepByStepTourHighlightPartSelector(STEP_BY_STEP_TOUR_TARGETS.knowledgeWithDatasetsFirstCardActionsMenu),
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
    },
  ],
  integration: [
    {
      taskId: 'integration',
      target: STEP_BY_STEP_TOUR_TARGETS.integrationModelProviderCredits,
      title: 'stepByStepTour.guides.integration.modelProvider.credits.title',
      description: 'stepByStepTour.guides.integration.modelProvider.credits.description',
      learnMoreLabel: 'stepByStepTour.learnMore',
      primaryActionLabel: 'stepByStepTour.guides.primaryActionLabel',
      integrationSection: 'provider',
    },
    {
      taskId: 'integration',
      target: STEP_BY_STEP_TOUR_TARGETS.integrationModelProviderProduction,
      title: 'stepByStepTour.guides.integration.modelProvider.production.title',
      description: 'stepByStepTour.guides.integration.modelProvider.production.description',
      learnMoreLabel: 'stepByStepTour.learnMore',
      primaryActionLabel: 'stepByStepTour.guides.primaryActionLabel',
      integrationSection: 'provider',
    },
    {
      taskId: 'integration',
      target: STEP_BY_STEP_TOUR_TARGETS.integrationModelProviderInstall,
      title: 'stepByStepTour.guides.integration.modelProvider.install.title',
      description: 'stepByStepTour.guides.integration.modelProvider.install.description',
      learnMoreLabel: 'stepByStepTour.learnMore',
      primaryActionLabel: 'stepByStepTour.guides.primaryActionLabel',
      integrationSection: 'provider',
      optional: true,
    },
    {
      taskId: 'integration',
      target: STEP_BY_STEP_TOUR_TARGETS.integrationToolPluginAutoUpdate,
      title: 'stepByStepTour.guides.integration.toolPlugin.autoUpdate.title',
      description: 'stepByStepTour.guides.integration.toolPlugin.autoUpdate.description',
      learnMoreLabel: 'stepByStepTour.learnMore',
      primaryActionLabel: 'stepByStepTour.guides.primaryActionLabel',
      integrationSection: 'builtin',
    },
    {
      taskId: 'integration',
      target: STEP_BY_STEP_TOUR_TARGETS.integrationToolPluginFirstCard,
      title: 'stepByStepTour.guides.integration.toolPlugin.card.title',
      description: 'stepByStepTour.guides.integration.toolPlugin.card.description',
      learnMoreLabel: 'stepByStepTour.learnMore',
      primaryActionLabel: 'stepByStepTour.guides.primaryActionLabel',
      integrationSection: 'builtin',
    },
    {
      taskId: 'integration',
      target: STEP_BY_STEP_TOUR_TARGETS.integrationMcpAdd,
      title: 'stepByStepTour.guides.integration.mcp.add.title',
      description: 'stepByStepTour.guides.integration.mcp.add.description',
      learnMoreLabel: 'stepByStepTour.learnMore',
      primaryActionLabel: 'stepByStepTour.guides.primaryActionLabel',
      integrationSection: 'mcp',
    },
    {
      taskId: 'integration',
      target: STEP_BY_STEP_TOUR_TARGETS.integrationMcpFirstCard,
      title: 'stepByStepTour.guides.integration.mcp.card.title',
      description: 'stepByStepTour.guides.integration.mcp.card.description',
      learnMoreLabel: 'stepByStepTour.learnMore',
      primaryActionLabel: 'stepByStepTour.guides.primaryActionLabel',
      integrationSection: 'mcp',
      optional: true,
    },
    {
      taskId: 'integration',
      target: STEP_BY_STEP_TOUR_TARGETS.integrationWorkflowToolGrid,
      title: 'stepByStepTour.guides.integration.workflowTool.title',
      description: 'stepByStepTour.guides.integration.workflowTool.description',
      learnMoreLabel: 'stepByStepTour.learnMore',
      primaryActionLabel: 'stepByStepTour.guides.primaryActionLabel',
      integrationSection: 'workflow-tool',
      learnMoreDocPath: '/use-dify/workspace/tools#workflow-tool',
    },
    {
      taskId: 'integration',
      target: STEP_BY_STEP_TOUR_TARGETS.integrationSwaggerToolGrid,
      title: 'stepByStepTour.guides.integration.swaggerTool.title',
      description: 'stepByStepTour.guides.integration.swaggerTool.description',
      learnMoreLabel: 'stepByStepTour.learnMore',
      primaryActionLabel: 'stepByStepTour.guides.primaryActionLabel',
      integrationSection: 'custom-tool',
      learnMoreDocPath: '/use-dify/workspace/tools#custom-tool',
    },
    {
      taskId: 'integration',
      target: STEP_BY_STEP_TOUR_TARGETS.integrationDataSourceFirstCard,
      title: 'stepByStepTour.guides.integration.dataSource.title',
      description: 'stepByStepTour.guides.integration.dataSource.description',
      learnMoreLabel: 'stepByStepTour.learnMore',
      primaryActionLabel: 'stepByStepTour.guides.primaryActionLabel',
      integrationSection: 'data-source',
      learnMoreDocPath: '/develop-plugin/dev-guides-and-walkthroughs/datasource-plugin#data-source-plugin-types',
    },
    {
      taskId: 'integration',
      target: STEP_BY_STEP_TOUR_TARGETS.integrationTriggerGrid,
      title: 'stepByStepTour.guides.integration.trigger.title',
      description: 'stepByStepTour.guides.integration.trigger.description',
      learnMoreLabel: 'stepByStepTour.learnMore',
      primaryActionLabel: 'stepByStepTour.guides.primaryActionLabel',
      integrationSection: 'trigger',
      learnMoreDocPath: '/develop-plugin/dev-guides-and-walkthroughs/trigger-plugin',
    },
    {
      taskId: 'integration',
      target: STEP_BY_STEP_TOUR_TARGETS.integrationAgentStrategyEmpty,
      title: 'stepByStepTour.guides.integration.agentStrategy.title',
      description: 'stepByStepTour.guides.integration.agentStrategy.description',
      learnMoreLabel: 'stepByStepTour.learnMore',
      primaryActionLabel: 'stepByStepTour.guides.primaryActionLabel',
      integrationSection: 'agent-strategy',
      learnMoreDocPath: '/develop-plugin/dev-guides-and-walkthroughs/agent-strategy-plugin',
    },
    {
      taskId: 'integration',
      target: STEP_BY_STEP_TOUR_TARGETS.integrationExtensionGrid,
      title: 'stepByStepTour.guides.integration.extension.title',
      description: 'stepByStepTour.guides.integration.extension.description',
      learnMoreLabel: 'stepByStepTour.learnMore',
      primaryActionLabel: 'stepByStepTour.guides.primaryActionLabel',
      integrationSection: 'extension',
      learnMoreDocPath: '/develop-plugin/dev-guides-and-walkthroughs/endpoint',
    },
    {
      taskId: 'integration',
      target: STEP_BY_STEP_TOUR_TARGETS.integrationCustomEndpointEmpty,
      title: 'stepByStepTour.guides.integration.customEndpoint.title',
      description: 'stepByStepTour.guides.integration.customEndpoint.description',
      learnMoreLabel: 'stepByStepTour.learnMore',
      primaryActionLabel: 'stepByStepTour.guides.primaryActionLabel',
      integrationSection: 'custom-endpoint',
      learnMoreDocPath: '/use-dify/workspace/api-extension/api-extension',
    },
  ],
}

const STEP_BY_STEP_TOUR_INTEGRATION_NO_PERMISSION_GUIDES: StepByStepTourGuide[] = [
  {
    taskId: 'integration',
    target: STEP_BY_STEP_TOUR_TARGETS.integration,
    title: 'stepByStepTour.guides.integration.noPermission.title',
    description: 'stepByStepTour.guides.integration.noPermission.description',
    learnMoreLabel: 'stepByStepTour.learnMore',
    primaryActionLabel: 'stepByStepTour.guides.primaryActionLabel',
    integrationSection: 'provider',
  },
]

const STEP_BY_STEP_TOUR_INTEGRATION_EDITOR_TARGETS = new Set<string>([
  STEP_BY_STEP_TOUR_TARGETS.integrationToolPluginFirstCard,
  STEP_BY_STEP_TOUR_TARGETS.integrationWorkflowToolGrid,
  STEP_BY_STEP_TOUR_TARGETS.integrationSwaggerToolGrid,
  STEP_BY_STEP_TOUR_TARGETS.integrationTriggerGrid,
  STEP_BY_STEP_TOUR_TARGETS.integrationAgentStrategyEmpty,
  STEP_BY_STEP_TOUR_TARGETS.integrationExtensionGrid,
  STEP_BY_STEP_TOUR_TARGETS.integrationCustomEndpointEmpty,
])

const STEP_BY_STEP_TOUR_INTEGRATION_EDITOR_GUIDES: StepByStepTourGuide[] = STEP_BY_STEP_TOUR_GUIDES.integration
  ?.filter(guide => STEP_BY_STEP_TOUR_INTEGRATION_EDITOR_TARGETS.has(guide.target)) ?? []

const isStepByStepTourStudioGuideGroup = (
  guideGroup?: StepByStepTourGuideGroup,
): guideGroup is Extract<StepByStepTourGuideGroup, 'studioEmpty' | 'studioWithApps'> =>
  guideGroup === 'studioEmpty' || guideGroup === 'studioWithApps'

const isStepByStepTourKnowledgeGuideGroup = (
  guideGroup?: StepByStepTourGuideGroup,
): guideGroup is Extract<StepByStepTourGuideGroup, 'knowledgeEmpty' | 'knowledgeWithDatasets'> =>
  guideGroup === 'knowledgeEmpty' || guideGroup === 'knowledgeWithDatasets'

const isStepByStepTourIntegrationGuideGroup = (
  guideGroup?: StepByStepTourGuideGroup,
): guideGroup is Extract<StepByStepTourGuideGroup, 'integrationEditor' | 'integrationNoPermission'> =>
  guideGroup === 'integrationEditor' || guideGroup === 'integrationNoPermission'

export const getStepByStepTourGuides = (
  taskId: StepByStepTourTaskId,
  guideGroup?: StepByStepTourGuideGroup,
) => {
  if (taskId === 'studio')
    return isStepByStepTourStudioGuideGroup(guideGroup) ? STEP_BY_STEP_TOUR_STUDIO_GUIDES[guideGroup] : []

  if (taskId === 'knowledge')
    return isStepByStepTourKnowledgeGuideGroup(guideGroup) ? STEP_BY_STEP_TOUR_KNOWLEDGE_GUIDES[guideGroup] : []

  if (taskId === 'integration' && isStepByStepTourIntegrationGuideGroup(guideGroup)) {
    return guideGroup === 'integrationEditor'
      ? STEP_BY_STEP_TOUR_INTEGRATION_EDITOR_GUIDES
      : STEP_BY_STEP_TOUR_INTEGRATION_NO_PERMISSION_GUIDES
  }

  return STEP_BY_STEP_TOUR_GUIDES[taskId] ?? []
}

export function getStepByStepTourTargetSelector(target: string) {
  return `[data-step-by-step-tour-target="${target}"]`
}

export function getStepByStepTourHighlightPartSelector(target: string) {
  return `[data-step-by-step-tour-highlight-part="${target}"]`
}
