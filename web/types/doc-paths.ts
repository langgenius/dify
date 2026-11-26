// GENERATE BY script
// DON NOT EDIT IT MANUALLY
//
// Generated from: https://raw.githubusercontent.com/langgenius/dify-docs/refs/heads/docs/evaluation/docs.json

// Language prefixes
export type DocLanguage = 'en' | 'zh' | 'ja'
export type DocsProduct = 'cloud' | 'self-host'

// UseDify paths
type UseDifyPath =
  | '/use-dify/build/additional-features'
  | '/use-dify/build/agent'
  | '/use-dify/build/chatbot'
  | '/use-dify/build/goto-anything'
  | '/use-dify/build/new-agent/build'
  | '/use-dify/build/new-agent/overview'
  | '/use-dify/build/orchestrate-node'
  | '/use-dify/build/predefined-error-handling-logic'
  | '/use-dify/build/shortcut-key'
  | '/use-dify/build/skills'
  | '/use-dify/build/snippet'
  | '/use-dify/build/text-generator'
  | '/use-dify/build/version-control'
  | '/use-dify/build/workflow-chatflow'
  | '/use-dify/build/workflow-collaboration'
  | '/use-dify/debug/error-type'
  | '/use-dify/debug/history-and-logs'
  | '/use-dify/debug/step-run'
  | '/use-dify/debug/variable-inspect'
  | '/use-dify/evaluate/custom-evaluators'
  | '/use-dify/evaluate/metrics'
  | '/use-dify/evaluate/run-evaluations'
  | '/use-dify/getting-started/introduction'
  | '/use-dify/knowledge-base/create-knowledge-base'
  | '/use-dify/knowledge-base/maintain-knowledge-base'
  | '/use-dify/knowledge-base/multimodal-retrieval'
  | '/use-dify/knowledge-base/overview'
  | '/use-dify/knowledge-base/retrieval-settings'
  | '/use-dify/knowledge-base/review-indexed-documents'
  | '/use-dify/knowledge-base/test-and-tune'
  | '/use-dify/knowledge-base/upgrade-from-classic'
  | '/use-dify/knowledge-base/use-knowledge-in-apps'
  | '/use-dify/knowledge/connect-external-knowledge-base'
  | '/use-dify/knowledge/create-knowledge/chunking-and-cleaning-text'
  | '/use-dify/knowledge/create-knowledge/import-text-data/readme'
  | '/use-dify/knowledge/create-knowledge/import-text-data/sync-from-notion'
  | '/use-dify/knowledge/create-knowledge/import-text-data/sync-from-website'
  | '/use-dify/knowledge/create-knowledge/introduction'
  | '/use-dify/knowledge/create-knowledge/setting-indexing-methods'
  | '/use-dify/knowledge/external-knowledge-api'
  | '/use-dify/knowledge/file-security-scan'
  | '/use-dify/knowledge/file-security-scan-custom-endpoint'
  | '/use-dify/knowledge/integrate-knowledge-within-application'
  | '/use-dify/knowledge/knowledge-pipeline/authorize-data-source'
  | '/use-dify/knowledge/knowledge-pipeline/create-knowledge-pipeline'
  | '/use-dify/knowledge/knowledge-pipeline/knowledge-pipeline-orchestration'
  | '/use-dify/knowledge/knowledge-pipeline/manage-knowledge-base'
  | '/use-dify/knowledge/knowledge-pipeline/publish-knowledge-pipeline'
  | '/use-dify/knowledge/knowledge-pipeline/readme'
  | '/use-dify/knowledge/knowledge-pipeline/upload-files'
  | '/use-dify/knowledge/knowledge-request-rate-limit'
  | '/use-dify/knowledge/knowledge-storage-limit'
  | '/use-dify/knowledge/manage-knowledge/introduction'
  | '/use-dify/knowledge/manage-knowledge/maintain-knowledge-documents'
  | '/use-dify/knowledge/metadata'
  | '/use-dify/knowledge/overview'
  | '/use-dify/knowledge/readme'
  | '/use-dify/knowledge/test-retrieval'
  | '/use-dify/monitor/analysis'
  | '/use-dify/monitor/annotation-reply'
  | '/use-dify/monitor/integrations/integrate-aliyun'
  | '/use-dify/monitor/integrations/integrate-arize'
  | '/use-dify/monitor/integrations/integrate-langfuse'
  | '/use-dify/monitor/integrations/integrate-langsmith'
  | '/use-dify/monitor/integrations/integrate-opik'
  | '/use-dify/monitor/integrations/integrate-phoenix'
  | '/use-dify/monitor/integrations/integrate-weave'
  | '/use-dify/monitor/logs'
  | '/use-dify/nodes/agent'
  | '/use-dify/nodes/answer'
  | '/use-dify/nodes/code'
  | '/use-dify/nodes/doc-extractor'
  | '/use-dify/nodes/http-request'
  | '/use-dify/nodes/human-input'
  | '/use-dify/nodes/ifelse'
  | '/use-dify/nodes/iteration'
  | '/use-dify/nodes/knowledge-retrieval'
  | '/use-dify/nodes/knowledge-retrieval-v2'
  | '/use-dify/nodes/list-operator'
  | '/use-dify/nodes/llm'
  | '/use-dify/nodes/loop'
  | '/use-dify/nodes/output'
  | '/use-dify/nodes/parameter-extractor'
  | '/use-dify/nodes/question-classifier'
  | '/use-dify/nodes/start'
  | '/use-dify/nodes/template'
  | '/use-dify/nodes/tools'
  | '/use-dify/nodes/trigger/overview'
  | '/use-dify/nodes/trigger/plugin-trigger'
  | '/use-dify/nodes/trigger/schedule-trigger'
  | '/use-dify/nodes/trigger/webhook-trigger'
  | '/use-dify/nodes/user-input'
  | '/use-dify/nodes/variable-aggregator'
  | '/use-dify/nodes/variable-assigner'
  | '/use-dify/publish/README'
  | '/use-dify/publish/ip-access-control'
  | '/use-dify/publish/publish-mcp'
  | '/use-dify/publish/publish-to-marketplace'
  | '/use-dify/publish/webapp/chatflow-webapp'
  | '/use-dify/publish/webapp/embedding-in-websites'
  | '/use-dify/publish/webapp/web-app-settings'
  | '/use-dify/publish/webapp/workflow-webapp'
  | '/use-dify/workspace/api-extension/api-extension'
  | '/use-dify/workspace/api-extension/cloudflare-worker'
  | '/use-dify/workspace/api-extension/external-data-tool-api-extension'
  | '/use-dify/workspace/api-extension/moderation-api-extension'
  | '/use-dify/workspace/channels/dingtalk'
  | '/use-dify/workspace/channels/feishu-lark'
  | '/use-dify/workspace/channels/ms-teams'
  | '/use-dify/workspace/channels/overview'
  | '/use-dify/workspace/channels/slack'
  | '/use-dify/workspace/channels/wecom'
  | '/use-dify/workspace/contacts'
  | '/use-dify/workspace/export-import-apps'
  | '/use-dify/workspace/model-providers'
  | '/use-dify/workspace/personal-account-management'
  | '/use-dify/workspace/plugins'
  | '/use-dify/workspace/readme'
  | '/use-dify/workspace/subscription-management'
  | '/use-dify/workspace/team-members-management'
  | '/use-dify/workspace/tools'

// UseDify node paths (without prefix)
type ExtractNodesPath<T> = T extends `/use-dify/nodes/${infer Path}` ? Path : never
export type UseDifyNodesPath = ExtractNodesPath<UseDifyPath>

// Home paths
type HomePath = '/home'

// Learn paths
type LearnPath =
  | '/learn/key-concepts'
  | '/learn/tutorials/article-reader'
  | '/learn/tutorials/build-ai-image-generation-app'
  | '/learn/tutorials/customer-service-bot'
  | '/learn/tutorials/simple-chatbot'
  | '/learn/tutorials/twitter-chatflow'
  | '/learn/tutorials/workflow-101/lesson-01'
  | '/learn/tutorials/workflow-101/lesson-02'
  | '/learn/tutorials/workflow-101/lesson-03'
  | '/learn/tutorials/workflow-101/lesson-04'
  | '/learn/tutorials/workflow-101/lesson-05'
  | '/learn/tutorials/workflow-101/lesson-06'
  | '/learn/tutorials/workflow-101/lesson-07'
  | '/learn/tutorials/workflow-101/lesson-08'
  | '/learn/tutorials/workflow-101/lesson-09'
  | '/learn/tutorials/workflow-101/lesson-10'

// QuickStart paths
type QuickStartPath = '/quick-start'

// ApiReference paths
type ApiReferencePath =
  | '/api-reference/guides/agent'
  | '/api-reference/guides/chat'
  | '/api-reference/guides/chatflow'
  | '/api-reference/guides/completion'
  | '/api-reference/guides/end-user-identity'
  | '/api-reference/guides/errors'
  | '/api-reference/guides/get-started'
  | '/api-reference/guides/human-input-flow'
  | '/api-reference/guides/knowledge'
  | '/api-reference/guides/knowledge-base'
  | '/api-reference/guides/knowledge-base-api'
  | '/api-reference/guides/streaming'
  | '/api-reference/guides/workflow'

// Cli paths
type CliPath =
  | '/cli/build-apps'
  | '/cli/create-and-update-apps-from-dsl-files'
  | '/cli/find-and-run-commands'
  | '/cli/get-started'
  | '/cli/manage-sign-in'
  | '/cli/overview'
  | '/cli/personal-access-tokens'
  | '/cli/reference/command-index'
  | '/cli/reference/configuration'
  | '/cli/reference/results-errors-and-exit-codes'
  | '/cli/run-apps'
  | '/cli/scripts-and-ci'
  | '/cli/update-or-uninstall'
  | '/cli/upgrade-across-1-18'

// DevelopPlugin paths
type DevelopPluginPath =
  | '/develop-plugin/dev-guides-and-walkthroughs/agent-strategy-plugin'
  | '/develop-plugin/dev-guides-and-walkthroughs/cheatsheet'
  | '/develop-plugin/dev-guides-and-walkthroughs/creating-new-model-provider'
  | '/develop-plugin/dev-guides-and-walkthroughs/datasource-plugin'
  | '/develop-plugin/dev-guides-and-walkthroughs/develop-a-slack-bot-plugin'
  | '/develop-plugin/dev-guides-and-walkthroughs/develop-flomo-plugin'
  | '/develop-plugin/dev-guides-and-walkthroughs/develop-md-exporter'
  | '/develop-plugin/dev-guides-and-walkthroughs/develop-multimodal-data-processing-tool'
  | '/develop-plugin/dev-guides-and-walkthroughs/endpoint'
  | '/develop-plugin/dev-guides-and-walkthroughs/tool-oauth'
  | '/develop-plugin/dev-guides-and-walkthroughs/tool-plugin'
  | '/develop-plugin/dev-guides-and-walkthroughs/trigger-plugin'
  | '/develop-plugin/features-and-specs/advanced-development/bundle'
  | '/develop-plugin/features-and-specs/advanced-development/customizable-model'
  | '/develop-plugin/features-and-specs/advanced-development/reverse-invocation'
  | '/develop-plugin/features-and-specs/advanced-development/reverse-invocation-app'
  | '/develop-plugin/features-and-specs/advanced-development/reverse-invocation-model'
  | '/develop-plugin/features-and-specs/advanced-development/reverse-invocation-node'
  | '/develop-plugin/features-and-specs/advanced-development/reverse-invocation-tool'
  | '/develop-plugin/features-and-specs/plugin-types/general-specifications'
  | '/develop-plugin/features-and-specs/plugin-types/model-designing-rules'
  | '/develop-plugin/features-and-specs/plugin-types/model-schema'
  | '/develop-plugin/features-and-specs/plugin-types/multilingual-readme'
  | '/develop-plugin/features-and-specs/plugin-types/persistent-storage-kv'
  | '/develop-plugin/features-and-specs/plugin-types/plugin-info-by-manifest'
  | '/develop-plugin/features-and-specs/plugin-types/plugin-logging'
  | '/develop-plugin/features-and-specs/plugin-types/remote-debug-a-plugin'
  | '/develop-plugin/features-and-specs/plugin-types/tool'
  | '/develop-plugin/getting-started/choose-plugin-type'
  | '/develop-plugin/getting-started/cli'
  | '/develop-plugin/getting-started/getting-started-dify-plugin'
  | '/develop-plugin/publishing/faq/faq'
  | '/develop-plugin/publishing/marketplace-listing/release-by-file'
  | '/develop-plugin/publishing/marketplace-listing/release-overview'
  | '/develop-plugin/publishing/marketplace-listing/release-to-individual-github-repo'
  | '/develop-plugin/publishing/marketplace-listing/submit-plugin-to-marketplace'
  | '/develop-plugin/publishing/standards/contributor-covenant-code-of-conduct'
  | '/develop-plugin/publishing/standards/privacy-protection-guidelines'
  | '/develop-plugin/publishing/standards/third-party-signature-verification'

// Deploy paths
type DeployPath =
  | '/deploy/advanced-deployments/local-source-code'
  | '/deploy/advanced-deployments/start-the-frontend-docker-container'
  | '/deploy/configuration/environments'
  | '/deploy/overview'
  | '/deploy/platform-guides/bt-panel'
  | '/deploy/platform-guides/dify-premium'
  | '/deploy/quick-start/docker-compose'
  | '/deploy/quick-start/faqs'
  | '/deploy/troubleshooting/common-issues'
  | '/deploy/troubleshooting/docker-issues'
  | '/deploy/troubleshooting/integrations'
  | '/deploy/troubleshooting/storage-and-migration'
  | '/deploy/troubleshooting/weaviate-server-migration-path'
  | '/deploy/troubleshooting/weaviate-v4-migration'

// API Reference endpoint paths
type ApiEndpointReferencePath =
  | '/api-reference/annotations/configure-annotation-reply'
  | '/api-reference/annotations/create-annotation'
  | '/api-reference/annotations/delete-annotation'
  | '/api-reference/annotations/get-annotation-reply-job-status'
  | '/api-reference/annotations/list-annotations'
  | '/api-reference/annotations/update-annotation'
  | '/api-reference/applications/get-app-info'
  | '/api-reference/applications/get-app-meta'
  | '/api-reference/applications/get-app-parameters'
  | '/api-reference/applications/get-app-webapp-settings'
  | '/api-reference/audio/convert-audio-to-text'
  | '/api-reference/audio/convert-text-to-audio'
  | '/api-reference/chat-messages/get-next-suggested-questions'
  | '/api-reference/chat-messages/send-chat-message'
  | '/api-reference/chat-messages/stop-chat-message-generation'
  | '/api-reference/chunks/create-child-chunk'
  | '/api-reference/chunks/create-chunks'
  | '/api-reference/chunks/delete-child-chunk'
  | '/api-reference/chunks/delete-chunk'
  | '/api-reference/chunks/get-chunk'
  | '/api-reference/chunks/list-child-chunks'
  | '/api-reference/chunks/list-chunks'
  | '/api-reference/chunks/update-child-chunk'
  | '/api-reference/chunks/update-chunk'
  | '/api-reference/completion-messages/send-completion-message'
  | '/api-reference/completion-messages/stop-completion-message-generation'
  | '/api-reference/conversations/delete-conversation'
  | '/api-reference/conversations/list-conversation-messages'
  | '/api-reference/conversations/list-conversation-variables'
  | '/api-reference/conversations/list-conversations'
  | '/api-reference/conversations/rename-conversation'
  | '/api-reference/conversations/update-conversation-variable'
  | '/api-reference/deletion-jobs/get-deletion-batch'
  | '/api-reference/deletion-jobs/get-deletion-job'
  | '/api-reference/documents-and-chunks/delete-document'
  | '/api-reference/documents-and-chunks/delete-document-file'
  | '/api-reference/documents-and-chunks/delete-document-files-in-batch'
  | '/api-reference/documents-and-chunks/get-chunk'
  | '/api-reference/documents-and-chunks/get-document'
  | '/api-reference/documents-and-chunks/get-document-by-file'
  | '/api-reference/documents-and-chunks/get-document-file'
  | '/api-reference/documents-and-chunks/get-document-outline'
  | '/api-reference/documents-and-chunks/list-chunks'
  | '/api-reference/documents-and-chunks/list-document-files'
  | '/api-reference/documents-and-chunks/list-document-revisions'
  | '/api-reference/documents-and-chunks/list-documents'
  | '/api-reference/documents-and-chunks/re-index-documents'
  | '/api-reference/documents-and-chunks/update-document-metadata'
  | '/api-reference/documents/create-document-by-file'
  | '/api-reference/documents/create-document-by-text'
  | '/api-reference/documents/delete-document'
  | '/api-reference/documents/download-document'
  | '/api-reference/documents/download-documents-as-zip'
  | '/api-reference/documents/get-document'
  | '/api-reference/documents/get-document-indexing-status'
  | '/api-reference/documents/list-documents'
  | '/api-reference/documents/update-document'
  | '/api-reference/documents/update-document-by-file'
  | '/api-reference/documents/update-document-by-text'
  | '/api-reference/documents/update-document-status-in-batch'
  | '/api-reference/end-users/get-end-user-info'
  | '/api-reference/feedback/list-app-feedbacks'
  | '/api-reference/feedback/submit-message-feedback'
  | '/api-reference/files/download-file'
  | '/api-reference/files/upload-file'
  | '/api-reference/human-input/get-human-input-form'
  | '/api-reference/human-input/submit-human-input-form'
  | '/api-reference/indexing-tasks/cancel-indexing-task'
  | '/api-reference/indexing-tasks/get-bulk-task'
  | '/api-reference/indexing-tasks/get-document-indexing-task'
  | '/api-reference/indexing-tasks/get-indexing-task'
  | '/api-reference/indexing-tasks/list-background-tasks'
  | '/api-reference/indexing-tasks/list-document-indexing-tasks'
  | '/api-reference/indexing-tasks/retry-indexing-task'
  | '/api-reference/knowledge-bases/create-an-empty-knowledge-base'
  | '/api-reference/knowledge-bases/delete-knowledge-base'
  | '/api-reference/knowledge-bases/get-knowledge-base'
  | '/api-reference/knowledge-bases/list-knowledge-bases'
  | '/api-reference/knowledge-bases/retrieve-chunks-from-a-knowledge-base-/-test-retrieval'
  | '/api-reference/knowledge-bases/update-knowledge-base'
  | '/api-reference/knowledge-pipeline/list-datasource-plugins'
  | '/api-reference/knowledge-pipeline/run-datasource-node'
  | '/api-reference/knowledge-pipeline/run-pipeline'
  | '/api-reference/knowledge-pipeline/upload-pipeline-file'
  | '/api-reference/metadata/create-metadata-field'
  | '/api-reference/metadata/delete-metadata-field'
  | '/api-reference/metadata/get-built-in-metadata-fields'
  | '/api-reference/metadata/list-metadata-fields'
  | '/api-reference/metadata/update-built-in-metadata-field'
  | '/api-reference/metadata/update-document-metadata-in-batch'
  | '/api-reference/metadata/update-metadata-field'
  | '/api-reference/models/get-available-models'
  | '/api-reference/queries/create-query-token'
  | '/api-reference/queries/run-query'
  | '/api-reference/query-records/get-query-record'
  | '/api-reference/query-records/list-missing-chunks'
  | '/api-reference/query-records/list-query-chunks'
  | '/api-reference/query-records/list-query-conflicts'
  | '/api-reference/query-records/list-query-records'
  | '/api-reference/research-tasks/cancel-research-task'
  | '/api-reference/research-tasks/create-research-task'
  | '/api-reference/research-tasks/get-research-task'
  | '/api-reference/research-tasks/list-research-task-results'
  | '/api-reference/research-tasks/list-research-tasks'
  | '/api-reference/research-tasks/plan-research-task'
  | '/api-reference/settings/get-knowledge-base-settings'
  | '/api-reference/settings/get-settings-migration'
  | '/api-reference/settings/update-knowledge-base-settings'
  | '/api-reference/source-syncs-and-imports/cancel-source-run'
  | '/api-reference/source-syncs-and-imports/get-source-run'
  | '/api-reference/source-syncs-and-imports/import-selected-pages'
  | '/api-reference/source-syncs-and-imports/import-source-items'
  | '/api-reference/source-syncs-and-imports/import-website-pages'
  | '/api-reference/source-syncs-and-imports/list-crawl-preview-pages'
  | '/api-reference/source-syncs-and-imports/list-source-runs'
  | '/api-reference/source-syncs-and-imports/preview-website-crawl'
  | '/api-reference/source-syncs-and-imports/retry-source-run'
  | '/api-reference/source-syncs-and-imports/sync-source'
  | '/api-reference/sources/create-source'
  | '/api-reference/sources/delete-source'
  | '/api-reference/sources/get-source'
  | '/api-reference/sources/get-sync-policy'
  | '/api-reference/sources/list-source-connections'
  | '/api-reference/sources/list-source-files'
  | '/api-reference/sources/list-source-pages'
  | '/api-reference/sources/list-sources'
  | '/api-reference/sources/test-source-credentials'
  | '/api-reference/sources/update-source'
  | '/api-reference/sources/update-sync-policy'
  | '/api-reference/tags/create-knowledge-tag'
  | '/api-reference/tags/create-tag-binding'
  | '/api-reference/tags/delete-knowledge-tag'
  | '/api-reference/tags/delete-tag-binding'
  | '/api-reference/tags/get-knowledge-base-tags'
  | '/api-reference/tags/list-knowledge-tags'
  | '/api-reference/tags/update-knowledge-tag'
  | '/api-reference/workflow-runs/get-workflow-run-detail'
  | '/api-reference/workflow-runs/list-workflow-logs'
  | '/api-reference/workflow-runs/run-workflow'
  | '/api-reference/workflow-runs/run-workflow-by-id'
  | '/api-reference/workflow-runs/stop-workflow-task'
  | '/api-reference/workflow-runs/stream-workflow-events'

// Base path without language prefix
type DocPathWithoutLangBase =
  | UseDifyPath
  | HomePath
  | LearnPath
  | QuickStartPath
  | ApiReferencePath
  | CliPath
  | DevelopPluginPath
  | DeployPath
  | ApiEndpointReferencePath

// Combined path without language prefix (supports optional #anchor)
export type DocPathWithoutLang = DocPathWithoutLangBase | `${DocPathWithoutLangBase}#${string}`

// Product availability for productless docs paths
export const docPathProductAvailability = {
  '/deploy/advanced-deployments/local-source-code': ['self-host'],
  '/deploy/advanced-deployments/start-the-frontend-docker-container': ['self-host'],
  '/deploy/configuration/environments': ['self-host'],
  '/deploy/overview': ['self-host'],
  '/deploy/platform-guides/bt-panel': ['self-host'],
  '/deploy/platform-guides/dify-premium': ['self-host'],
  '/deploy/quick-start/docker-compose': ['self-host'],
  '/deploy/quick-start/faqs': ['self-host'],
  '/deploy/troubleshooting/common-issues': ['self-host'],
  '/deploy/troubleshooting/docker-issues': ['self-host'],
  '/deploy/troubleshooting/integrations': ['self-host'],
  '/deploy/troubleshooting/storage-and-migration': ['self-host'],
  '/deploy/troubleshooting/weaviate-server-migration-path': ['self-host'],
  '/deploy/troubleshooting/weaviate-v4-migration': ['self-host'],
  '/use-dify/build/additional-features': ['cloud', 'self-host'],
  '/use-dify/build/agent': ['cloud', 'self-host'],
  '/use-dify/build/chatbot': ['cloud', 'self-host'],
  '/use-dify/build/goto-anything': ['cloud', 'self-host'],
  '/use-dify/build/new-agent/build': ['cloud', 'self-host'],
  '/use-dify/build/new-agent/overview': ['cloud', 'self-host'],
  '/use-dify/build/orchestrate-node': ['cloud', 'self-host'],
  '/use-dify/build/predefined-error-handling-logic': ['cloud', 'self-host'],
  '/use-dify/build/shortcut-key': ['cloud', 'self-host'],
  '/use-dify/build/skills': ['self-host'],
  '/use-dify/build/snippet': ['cloud', 'self-host'],
  '/use-dify/build/text-generator': ['cloud', 'self-host'],
  '/use-dify/build/version-control': ['cloud', 'self-host'],
  '/use-dify/build/workflow-chatflow': ['cloud', 'self-host'],
  '/use-dify/build/workflow-collaboration': ['self-host'],
  '/use-dify/debug/error-type': ['cloud', 'self-host'],
  '/use-dify/debug/history-and-logs': ['cloud', 'self-host'],
  '/use-dify/debug/step-run': ['cloud', 'self-host'],
  '/use-dify/debug/variable-inspect': ['cloud', 'self-host'],
  '/use-dify/evaluate/custom-evaluators': ['cloud'],
  '/use-dify/evaluate/metrics': ['cloud'],
  '/use-dify/evaluate/run-evaluations': ['cloud'],
  '/use-dify/getting-started/introduction': ['cloud', 'self-host'],
  '/use-dify/knowledge-base/create-knowledge-base': ['cloud'],
  '/use-dify/knowledge-base/maintain-knowledge-base': ['cloud'],
  '/use-dify/knowledge-base/multimodal-retrieval': ['cloud'],
  '/use-dify/knowledge-base/overview': ['cloud'],
  '/use-dify/knowledge-base/retrieval-settings': ['cloud'],
  '/use-dify/knowledge-base/review-indexed-documents': ['cloud'],
  '/use-dify/knowledge-base/test-and-tune': ['cloud'],
  '/use-dify/knowledge-base/upgrade-from-classic': ['cloud'],
  '/use-dify/knowledge-base/use-knowledge-in-apps': ['cloud'],
  '/use-dify/knowledge/connect-external-knowledge-base': ['cloud', 'self-host'],
  '/use-dify/knowledge/create-knowledge/chunking-and-cleaning-text': ['cloud', 'self-host'],
  '/use-dify/knowledge/create-knowledge/import-text-data/readme': ['cloud', 'self-host'],
  '/use-dify/knowledge/create-knowledge/import-text-data/sync-from-notion': ['cloud', 'self-host'],
  '/use-dify/knowledge/create-knowledge/import-text-data/sync-from-website': ['cloud', 'self-host'],
  '/use-dify/knowledge/create-knowledge/introduction': ['cloud', 'self-host'],
  '/use-dify/knowledge/create-knowledge/setting-indexing-methods': ['cloud', 'self-host'],
  '/use-dify/knowledge/external-knowledge-api': ['cloud', 'self-host'],
  '/use-dify/knowledge/file-security-scan': ['cloud', 'self-host'],
  '/use-dify/knowledge/file-security-scan-custom-endpoint': ['cloud', 'self-host'],
  '/use-dify/knowledge/integrate-knowledge-within-application': ['cloud', 'self-host'],
  '/use-dify/knowledge/knowledge-pipeline/authorize-data-source': ['cloud', 'self-host'],
  '/use-dify/knowledge/knowledge-pipeline/create-knowledge-pipeline': ['cloud', 'self-host'],
  '/use-dify/knowledge/knowledge-pipeline/knowledge-pipeline-orchestration': ['cloud', 'self-host'],
  '/use-dify/knowledge/knowledge-pipeline/manage-knowledge-base': ['cloud', 'self-host'],
  '/use-dify/knowledge/knowledge-pipeline/publish-knowledge-pipeline': ['cloud', 'self-host'],
  '/use-dify/knowledge/knowledge-pipeline/readme': ['cloud', 'self-host'],
  '/use-dify/knowledge/knowledge-pipeline/upload-files': ['cloud', 'self-host'],
  '/use-dify/knowledge/knowledge-request-rate-limit': ['cloud'],
  '/use-dify/knowledge/knowledge-storage-limit': ['cloud'],
  '/use-dify/knowledge/manage-knowledge/introduction': ['cloud', 'self-host'],
  '/use-dify/knowledge/manage-knowledge/maintain-knowledge-documents': ['cloud', 'self-host'],
  '/use-dify/knowledge/metadata': ['cloud', 'self-host'],
  '/use-dify/knowledge/overview': ['cloud'],
  '/use-dify/knowledge/readme': ['cloud', 'self-host'],
  '/use-dify/knowledge/test-retrieval': ['cloud', 'self-host'],
  '/use-dify/monitor/analysis': ['cloud', 'self-host'],
  '/use-dify/monitor/annotation-reply': ['cloud', 'self-host'],
  '/use-dify/monitor/integrations/integrate-aliyun': ['cloud', 'self-host'],
  '/use-dify/monitor/integrations/integrate-arize': ['cloud', 'self-host'],
  '/use-dify/monitor/integrations/integrate-langfuse': ['cloud', 'self-host'],
  '/use-dify/monitor/integrations/integrate-langsmith': ['cloud', 'self-host'],
  '/use-dify/monitor/integrations/integrate-opik': ['cloud', 'self-host'],
  '/use-dify/monitor/integrations/integrate-phoenix': ['cloud', 'self-host'],
  '/use-dify/monitor/integrations/integrate-weave': ['cloud', 'self-host'],
  '/use-dify/monitor/logs': ['cloud', 'self-host'],
  '/use-dify/nodes/agent': ['cloud', 'self-host'],
  '/use-dify/nodes/answer': ['cloud', 'self-host'],
  '/use-dify/nodes/code': ['cloud', 'self-host'],
  '/use-dify/nodes/doc-extractor': ['cloud', 'self-host'],
  '/use-dify/nodes/http-request': ['cloud', 'self-host'],
  '/use-dify/nodes/human-input': ['cloud', 'self-host'],
  '/use-dify/nodes/ifelse': ['cloud', 'self-host'],
  '/use-dify/nodes/iteration': ['cloud', 'self-host'],
  '/use-dify/nodes/knowledge-retrieval': ['cloud', 'self-host'],
  '/use-dify/nodes/knowledge-retrieval-v2': ['cloud'],
  '/use-dify/nodes/list-operator': ['cloud', 'self-host'],
  '/use-dify/nodes/llm': ['cloud', 'self-host'],
  '/use-dify/nodes/loop': ['cloud', 'self-host'],
  '/use-dify/nodes/output': ['cloud', 'self-host'],
  '/use-dify/nodes/parameter-extractor': ['cloud', 'self-host'],
  '/use-dify/nodes/question-classifier': ['cloud', 'self-host'],
  '/use-dify/nodes/start': ['cloud', 'self-host'],
  '/use-dify/nodes/template': ['cloud', 'self-host'],
  '/use-dify/nodes/tools': ['cloud', 'self-host'],
  '/use-dify/nodes/trigger/overview': ['cloud', 'self-host'],
  '/use-dify/nodes/trigger/plugin-trigger': ['cloud', 'self-host'],
  '/use-dify/nodes/trigger/schedule-trigger': ['cloud', 'self-host'],
  '/use-dify/nodes/trigger/webhook-trigger': ['cloud', 'self-host'],
  '/use-dify/nodes/user-input': ['cloud', 'self-host'],
  '/use-dify/nodes/variable-aggregator': ['cloud', 'self-host'],
  '/use-dify/nodes/variable-assigner': ['cloud', 'self-host'],
  '/use-dify/publish/README': ['cloud', 'self-host'],
  '/use-dify/publish/ip-access-control': ['cloud'],
  '/use-dify/publish/publish-mcp': ['cloud', 'self-host'],
  '/use-dify/publish/publish-to-marketplace': ['cloud', 'self-host'],
  '/use-dify/publish/webapp/chatflow-webapp': ['cloud', 'self-host'],
  '/use-dify/publish/webapp/embedding-in-websites': ['cloud', 'self-host'],
  '/use-dify/publish/webapp/web-app-settings': ['cloud', 'self-host'],
  '/use-dify/publish/webapp/workflow-webapp': ['cloud', 'self-host'],
  '/use-dify/workspace/api-extension/api-extension': ['cloud', 'self-host'],
  '/use-dify/workspace/api-extension/cloudflare-worker': ['cloud', 'self-host'],
  '/use-dify/workspace/api-extension/external-data-tool-api-extension': ['cloud', 'self-host'],
  '/use-dify/workspace/api-extension/moderation-api-extension': ['cloud', 'self-host'],
  '/use-dify/workspace/channels/dingtalk': ['self-host'],
  '/use-dify/workspace/channels/feishu-lark': ['self-host'],
  '/use-dify/workspace/channels/ms-teams': ['self-host'],
  '/use-dify/workspace/channels/overview': ['self-host'],
  '/use-dify/workspace/channels/slack': ['self-host'],
  '/use-dify/workspace/channels/wecom': ['self-host'],
  '/use-dify/workspace/contacts': ['self-host'],
  '/use-dify/workspace/export-import-apps': ['cloud', 'self-host'],
  '/use-dify/workspace/model-providers': ['cloud', 'self-host'],
  '/use-dify/workspace/personal-account-management': ['cloud', 'self-host'],
  '/use-dify/workspace/plugins': ['cloud', 'self-host'],
  '/use-dify/workspace/readme': ['cloud', 'self-host'],
  '/use-dify/workspace/subscription-management': ['cloud'],
  '/use-dify/workspace/team-members-management': ['cloud', 'self-host'],
  '/use-dify/workspace/tools': ['cloud', 'self-host'],
} as const satisfies Record<string, readonly DocsProduct[]>

export type ProductlessDocPath = keyof typeof docPathProductAvailability
export type ProductlessDocPathWithAnchor = ProductlessDocPath | `${ProductlessDocPath}#${string}`

export const isProductlessDocPath = (path: string): path is ProductlessDocPath =>
  Object.hasOwn(docPathProductAvailability, path)

export const isProductlessDocPathWithAnchor = (
  path: string,
): path is ProductlessDocPathWithAnchor => {
  const pathname = path.split('#', 1)[0]
  return Boolean(pathname && isProductlessDocPath(pathname))
}
