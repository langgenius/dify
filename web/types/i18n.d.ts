// TypeScript type definitions for Dify's i18next configuration
// This file is auto-generated. Do not edit manually.
// To regenerate, run: pnpm run gen:i18n-types
import 'react-i18next'

// Extract types from translation files using typeof import pattern

type AppAnnotationMessages = typeof import('../i18n/en-US/app-annotation').default
type AppApiMessages = typeof import('../i18n/en-US/app-api').default
type AppDebugMessages = typeof import('../i18n/en-US/app-debug').default
type AppLogMessages = typeof import('../i18n/en-US/app-log').default
type AppOverviewMessages = typeof import('../i18n/en-US/app-overview').default
type AppMessages = typeof import('../i18n/en-US/app').default
type BillingMessages = typeof import('../i18n/en-US/billing').default
type CommonMessages = typeof import('../i18n/en-US/common').default
type CustomMessages = typeof import('../i18n/en-US/custom').default
type DatasetCreationMessages = typeof import('../i18n/en-US/dataset-creation').default
type DatasetDocumentsMessages = typeof import('../i18n/en-US/dataset-documents').default
type DatasetHitTestingMessages = typeof import('../i18n/en-US/dataset-hit-testing').default
type DatasetPipelineMessages = typeof import('../i18n/en-US/dataset-pipeline').default
type DatasetSettingsMessages = typeof import('../i18n/en-US/dataset-settings').default
type DatasetMessages = typeof import('../i18n/en-US/dataset').default
type EducationMessages = typeof import('../i18n/en-US/education').default
type ExploreMessages = typeof import('../i18n/en-US/explore').default
type LayoutMessages = typeof import('../i18n/en-US/layout').default
type LoginMessages = typeof import('../i18n/en-US/login').default
type OauthMessages = typeof import('../i18n/en-US/oauth').default
type PipelineMessages = typeof import('../i18n/en-US/pipeline').default
type PluginTagsMessages = typeof import('../i18n/en-US/plugin-tags').default
type PluginMessages = typeof import('../i18n/en-US/plugin').default
type RegisterMessages = typeof import('../i18n/en-US/register').default
type RunLogMessages = typeof import('../i18n/en-US/run-log').default
type ShareMessages = typeof import('../i18n/en-US/share').default
type TimeMessages = typeof import('../i18n/en-US/time').default
type ToolsMessages = typeof import('../i18n/en-US/tools').default
type WorkflowMessages = typeof import('../i18n/en-US/workflow').default

// Complete type structure that matches i18next-config.ts camelCase conversion
export type Messages = {
  appAnnotation: AppAnnotationMessages;
  appApi: AppApiMessages;
  appDebug: AppDebugMessages;
  appLog: AppLogMessages;
  appOverview: AppOverviewMessages;
  app: AppMessages;
  billing: BillingMessages;
  common: CommonMessages;
  custom: CustomMessages;
  datasetCreation: DatasetCreationMessages;
  datasetDocuments: DatasetDocumentsMessages;
  datasetHitTesting: DatasetHitTestingMessages;
  datasetPipeline: DatasetPipelineMessages;
  datasetSettings: DatasetSettingsMessages;
  dataset: DatasetMessages;
  education: EducationMessages;
  explore: ExploreMessages;
  layout: LayoutMessages;
  login: LoginMessages;
  oauth: OauthMessages;
  pipeline: PipelineMessages;
  pluginTags: PluginTagsMessages;
  plugin: PluginMessages;
  register: RegisterMessages;
  runLog: RunLogMessages;
  share: ShareMessages;
  time: TimeMessages;
  tools: ToolsMessages;
  workflow: WorkflowMessages;
}

// Utility type to flatten nested object keys into dot notation
type FlattenKeys<T> = T extends object
  ? {
    [K in keyof T]: T[K] extends object
      ? `${K & string}.${FlattenKeys<T[K]> & string}`
      : `${K & string}`
  }[keyof T]
  : never

export type ValidTranslationKeys = FlattenKeys<Messages>

// Extend react-i18next with Dify's type structure
declare module 'react-i18next' {
  type CustomTypeOptions = {
    defaultNS: 'translation';
    resources: {
      translation: Messages;
    };
  }
}

// Extend i18next for complete type safety
declare module 'i18next' {
  type CustomTypeOptions = {
    defaultNS: 'translation';
    resources: {
      translation: Messages;
    };
  }
}
