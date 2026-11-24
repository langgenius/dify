import type { RagPipelineDatasourceProviderResponse as DataSourceItem } from '@dify/contracts/api/console/rag/types.gen'
import type { Source, SourceWorkflowRun } from '../source-models'

export const source = (overrides: Partial<Source>): Source => ({
  createdAt: '2026-07-20T10:00:00Z',
  id: 'source-1',
  knowledgeSpaceId: 'space-1',
  metadata: {},
  name: 'Product documentation',
  status: 'active',
  type: 'web',
  updatedAt: '2026-07-20T10:00:00Z',
  uri: 'https://docs.example.com',
  version: 3,
  ...overrides,
})

export const firecrawlDatasourcePlugin: DataSourceItem = {
  declaration: {
    credentials_schema: [],
    datasources: [
      {
        description: { en_US: 'Firecrawl', zh_Hans: 'Firecrawl' },
        identity: {
          author: 'langgenius',
          label: { en_US: 'Firecrawl', zh_Hans: 'Firecrawl' },
          name: 'crawl',
          provider: 'firecrawl',
        },
        parameters: [
          {
            description: { en_US: '' },
            label: { en_US: 'Starting URL' },
            name: 'url',
            required: true,
            type: 'string',
          },
          {
            default: true,
            description: { en_US: '' },
            label: { en_US: 'Follow links' },
            name: 'crawl_subpages',
            required: false,
            type: 'boolean',
          },
          {
            default: 100,
            description: { en_US: '' },
            label: { en_US: 'Page cap' },
            max: 200,
            min: 1,
            name: 'limit',
            required: false,
            type: 'number',
            precision: 0,
          },
          {
            description: { en_US: '' },
            label: { en_US: 'Included paths' },
            name: 'include_paths',
            required: false,
            type: 'string',
          },
        ],
      },
    ],
    identity: {
      author: 'langgenius',
      description: { en_US: 'Firecrawl', zh_Hans: 'Firecrawl' },
      icon: 'icon.svg',
      label: { en_US: 'Firecrawl', zh_Hans: 'Firecrawl' },
      name: 'firecrawl',
      tags: [],
    },
    provider_type: 'website_crawl',
  },
  is_authorized: true,
  plugin_id: 'langgenius/firecrawl_datasource',
  plugin_unique_identifier: 'langgenius/firecrawl_datasource:1.0.0@local',
  provider: 'firecrawl',
}

export const notionDatasourcePlugin: DataSourceItem = {
  declaration: {
    credentials_schema: [],
    datasources: [
      {
        description: { en_US: 'Notion', zh_Hans: 'Notion' },
        identity: {
          author: 'langgenius',
          label: { en_US: 'Notion', zh_Hans: 'Notion' },
          name: 'notion',
          provider: 'notion_datasource',
        },
        parameters: [
          {
            description: { en_US: '' },
            label: { en_US: 'Workspace' },
            name: 'workspace',
            required: true,
            type: 'string',
          },
        ],
      },
    ],
    identity: {
      author: 'langgenius',
      description: { en_US: 'Notion', zh_Hans: 'Notion' },
      icon: 'icon.svg',
      label: { en_US: 'Notion', zh_Hans: 'Notion' },
      name: 'notion_datasource',
      tags: [],
    },
    provider_type: 'online_document',
  },
  is_authorized: true,
  plugin_id: 'langgenius/notion_datasource',
  plugin_unique_identifier: 'langgenius/notion_datasource:1.0.0@local',
  provider: 'notion_datasource',
}

export const googleDriveDatasourcePlugin: DataSourceItem = {
  declaration: {
    credentials_schema: [],
    datasources: [
      {
        description: { en_US: 'Google Drive', zh_Hans: 'Google Drive' },
        identity: {
          author: 'langgenius',
          label: { en_US: 'Google Drive', zh_Hans: 'Google Drive' },
          name: 'google_drive',
          provider: 'google_drive',
        },
        parameters: [
          {
            description: { en_US: '' },
            label: { en_US: 'Folder' },
            name: 'folder',
            required: true,
            type: 'string',
          },
        ],
      },
    ],
    identity: {
      author: 'langgenius',
      description: { en_US: 'Google Drive', zh_Hans: 'Google Drive' },
      icon: 'icon.svg',
      label: { en_US: 'Google Drive', zh_Hans: 'Google Drive' },
      name: 'google_drive',
      tags: [],
    },
    provider_type: 'online_drive',
  },
  is_authorized: true,
  plugin_id: 'langgenius/google_drive',
  plugin_unique_identifier: 'langgenius/google_drive:1.0.0@local',
  provider: 'google_drive',
}

export const sourceConnectionResponse = {
  auth_kind: 'endpoint' as const,
  configuration: {
    credentialId: 'credential-1',
    datasource: 'crawl',
    pluginId: 'langgenius/firecrawl_datasource',
    provider: 'firecrawl',
    providerKind: 'website',
  },
  created_at: '2026-07-20T10:00:00Z',
  id: 'connection-1',
  knowledge_space_id: 'space-1',
  name: 'Firecrawl',
  provider_id: 'plugin-daemon-website',
  scopes: [],
  status: 'active' as const,
  updated_at: '2026-07-20T10:00:00Z',
  version: 1,
}

export const workflow = (state = 'queued') => ({
  canceled_at: null,
  checkpoint: 'sync',
  completed_at: null,
  created_at: '2026-07-20T10:00:00Z',
  execution_attempts: 1,
  id: 'workflow-1',
  kind: 'sync',
  knowledge_space_id: 'space-1',
  last_error_code: null,
  max_execution_attempts: 3,
  progress_completed: 0,
  progress_failed: 0,
  progress_skipped: 0,
  progress_total: 1,
  source_id: 'source-1',
  state,
  updated_at: '2026-07-20T10:00:00Z',
})

export const sourceWorkflow = (state = 'queued'): SourceWorkflowRun => ({
  checkpoint: 'sync',
  createdAt: '2026-07-20T10:00:00Z',
  executionAttempts: 1,
  id: 'workflow-1',
  kind: 'sync',
  knowledgeSpaceId: 'space-1',
  maxExecutionAttempts: 3,
  progressCompleted: 0,
  progressFailed: 0,
  progressSkipped: 0,
  progressTotal: 1,
  sourceId: 'source-1',
  state,
  updatedAt: '2026-07-20T10:00:00Z',
})
