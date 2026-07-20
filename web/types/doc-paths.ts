// GENERATE BY script
// DON NOT EDIT IT MANUALLY
//
// Generated from: https://raw.githubusercontent.com/langgenius/dify-docs/refs/heads/main/docs.json
// Generated at: 2026-07-09T10:55:53.618Z

// Language prefixes
export type DocLanguage = 'en' | 'zh' | 'ja'
export type DocsProduct = 'cloud' | 'self-host'

// Cloud paths
type CloudPath =
  | '/cloud/use-dify/build/additional-features'
  | '/cloud/use-dify/build/agent'
  | '/cloud/use-dify/build/chatbot'
  | '/cloud/use-dify/build/orchestrate-node'
  | '/cloud/use-dify/build/predefined-error-handling-logic'
  | '/cloud/use-dify/build/shortcut-key'
  | '/cloud/use-dify/build/text-generator'
  | '/cloud/use-dify/build/version-control'
  | '/cloud/use-dify/build/workflow-chatflow'
  | '/cloud/use-dify/debug/error-type'
  | '/cloud/use-dify/debug/history-and-logs'
  | '/cloud/use-dify/debug/step-run'
  | '/cloud/use-dify/debug/variable-inspect'
  | '/cloud/use-dify/getting-started/introduction'
  | '/cloud/use-dify/knowledge/connect-external-knowledge-base'
  | '/cloud/use-dify/knowledge/create-knowledge/chunking-and-cleaning-text'
  | '/cloud/use-dify/knowledge/create-knowledge/import-text-data/readme'
  | '/cloud/use-dify/knowledge/create-knowledge/import-text-data/sync-from-notion'
  | '/cloud/use-dify/knowledge/create-knowledge/import-text-data/sync-from-website'
  | '/cloud/use-dify/knowledge/create-knowledge/introduction'
  | '/cloud/use-dify/knowledge/create-knowledge/setting-indexing-methods'
  | '/cloud/use-dify/knowledge/external-knowledge-api'
  | '/cloud/use-dify/knowledge/integrate-knowledge-within-application'
  | '/cloud/use-dify/knowledge/knowledge-pipeline/authorize-data-source'
  | '/cloud/use-dify/knowledge/knowledge-pipeline/create-knowledge-pipeline'
  | '/cloud/use-dify/knowledge/knowledge-pipeline/knowledge-pipeline-orchestration'
  | '/cloud/use-dify/knowledge/knowledge-pipeline/manage-knowledge-base'
  | '/cloud/use-dify/knowledge/knowledge-pipeline/publish-knowledge-pipeline'
  | '/cloud/use-dify/knowledge/knowledge-pipeline/readme'
  | '/cloud/use-dify/knowledge/knowledge-pipeline/upload-files'
  | '/cloud/use-dify/knowledge/knowledge-request-rate-limit'
  | '/cloud/use-dify/knowledge/manage-knowledge/introduction'
  | '/cloud/use-dify/knowledge/manage-knowledge/maintain-knowledge-documents'
  | '/cloud/use-dify/knowledge/metadata'
  | '/cloud/use-dify/knowledge/readme'
  | '/cloud/use-dify/knowledge/test-retrieval'
  | '/cloud/use-dify/monitor/analysis'
  | '/cloud/use-dify/monitor/annotation-reply'
  | '/cloud/use-dify/monitor/integrations/integrate-aliyun'
  | '/cloud/use-dify/monitor/integrations/integrate-arize'
  | '/cloud/use-dify/monitor/integrations/integrate-langfuse'
  | '/cloud/use-dify/monitor/integrations/integrate-langsmith'
  | '/cloud/use-dify/monitor/integrations/integrate-opik'
  | '/cloud/use-dify/monitor/integrations/integrate-phoenix'
  | '/cloud/use-dify/monitor/integrations/integrate-weave'
  | '/cloud/use-dify/monitor/logs'
  | '/cloud/use-dify/nodes/agent'
  | '/cloud/use-dify/nodes/answer'
  | '/cloud/use-dify/nodes/code'
  | '/cloud/use-dify/nodes/doc-extractor'
  | '/cloud/use-dify/nodes/http-request'
  | '/cloud/use-dify/nodes/human-input'
  | '/cloud/use-dify/nodes/ifelse'
  | '/cloud/use-dify/nodes/iteration'
  | '/cloud/use-dify/nodes/knowledge-retrieval'
  | '/cloud/use-dify/nodes/list-operator'
  | '/cloud/use-dify/nodes/llm'
  | '/cloud/use-dify/nodes/loop'
  | '/cloud/use-dify/nodes/output'
  | '/cloud/use-dify/nodes/parameter-extractor'
  | '/cloud/use-dify/nodes/question-classifier'
  | '/cloud/use-dify/nodes/start'
  | '/cloud/use-dify/nodes/template'
  | '/cloud/use-dify/nodes/tools'
  | '/cloud/use-dify/nodes/trigger/overview'
  | '/cloud/use-dify/nodes/trigger/plugin-trigger'
  | '/cloud/use-dify/nodes/trigger/schedule-trigger'
  | '/cloud/use-dify/nodes/trigger/webhook-trigger'
  | '/cloud/use-dify/nodes/user-input'
  | '/cloud/use-dify/nodes/variable-aggregator'
  | '/cloud/use-dify/nodes/variable-assigner'
  | '/cloud/use-dify/publish/README'
  | '/cloud/use-dify/publish/publish-mcp'
  | '/cloud/use-dify/publish/publish-to-marketplace'
  | '/cloud/use-dify/publish/webapp/chatflow-webapp'
  | '/cloud/use-dify/publish/webapp/embedding-in-websites'
  | '/cloud/use-dify/publish/webapp/web-app-settings'
  | '/cloud/use-dify/publish/webapp/workflow-webapp'
  | '/cloud/use-dify/workspace/api-extension/api-extension'
  | '/cloud/use-dify/workspace/api-extension/cloudflare-worker'
  | '/cloud/use-dify/workspace/api-extension/external-data-tool-api-extension'
  | '/cloud/use-dify/workspace/api-extension/moderation-api-extension'
  | '/cloud/use-dify/workspace/app-management'
  | '/cloud/use-dify/workspace/model-providers'
  | '/cloud/use-dify/workspace/personal-account-management'
  | '/cloud/use-dify/workspace/plugins'
  | '/cloud/use-dify/workspace/readme'
  | '/cloud/use-dify/workspace/subscription-management'
  | '/cloud/use-dify/workspace/team-members-management'
  | '/cloud/use-dify/workspace/tools'

// UseDify paths
type UseDifyPath =
  | '/use-dify/build/additional-features'
  | '/use-dify/build/agent'
  | '/use-dify/build/chatbot'
  | '/use-dify/build/new-agent/build'
  | '/use-dify/build/new-agent/overview'
  | '/use-dify/build/orchestrate-node'
  | '/use-dify/build/predefined-error-handling-logic'
  | '/use-dify/build/shortcut-key'
  | '/use-dify/build/text-generator'
  | '/use-dify/build/version-control'
  | '/use-dify/build/workflow-chatflow'
  | '/use-dify/build/workflow-collaboration'
  | '/use-dify/debug/error-type'
  | '/use-dify/debug/history-and-logs'
  | '/use-dify/debug/step-run'
  | '/use-dify/debug/variable-inspect'
  | '/use-dify/getting-started/introduction'
  | '/use-dify/knowledge/connect-external-knowledge-base'
  | '/use-dify/knowledge/create-knowledge/chunking-and-cleaning-text'
  | '/use-dify/knowledge/create-knowledge/import-text-data/readme'
  | '/use-dify/knowledge/create-knowledge/import-text-data/sync-from-notion'
  | '/use-dify/knowledge/create-knowledge/import-text-data/sync-from-website'
  | '/use-dify/knowledge/create-knowledge/introduction'
  | '/use-dify/knowledge/create-knowledge/setting-indexing-methods'
  | '/use-dify/knowledge/external-knowledge-api'
  | '/use-dify/knowledge/integrate-knowledge-within-application'
  | '/use-dify/knowledge/knowledge-pipeline/authorize-data-source'
  | '/use-dify/knowledge/knowledge-pipeline/create-knowledge-pipeline'
  | '/use-dify/knowledge/knowledge-pipeline/knowledge-pipeline-orchestration'
  | '/use-dify/knowledge/knowledge-pipeline/manage-knowledge-base'
  | '/use-dify/knowledge/knowledge-pipeline/publish-knowledge-pipeline'
  | '/use-dify/knowledge/knowledge-pipeline/readme'
  | '/use-dify/knowledge/knowledge-pipeline/upload-files'
  | '/use-dify/knowledge/knowledge-request-rate-limit'
  | '/use-dify/knowledge/manage-knowledge/introduction'
  | '/use-dify/knowledge/manage-knowledge/maintain-knowledge-documents'
  | '/use-dify/knowledge/metadata'
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
  | '/use-dify/workspace/app-management'
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
  | '/api-reference/guides/streaming'
  | '/api-reference/guides/workflow'

// Cli paths
type CliPath =
  | '/cli/authenticate'
  | '/cli/common-tasks'
  | '/cli/install'
  | '/cli/integrate-agents/auth-for-agent-deployments'
  | '/cli/integrate-agents/error-handling-and-retries-for-agents'
  | '/cli/integrate-agents/install-the-difyctl-skill'
  | '/cli/integrate-agents/overview'
  | '/cli/overview'
  | '/cli/quick-start'
  | '/cli/reference/apps'
  | '/cli/reference/auth-and-contexts'
  | '/cli/reference/command-index'
  | '/cli/reference/environment-variables'
  | '/cli/reference/global-flags'
  | '/cli/reference/help'
  | '/cli/reference/output-formats-and-exit-codes'
  | '/cli/reference/skills'
  | '/cli/reference/version'
  | '/cli/reference/workspaces'
  | '/cli/troubleshooting'

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
  | '/develop-plugin/publishing/marketplace-listing/plugin-auto-publish-pr'
  | '/develop-plugin/publishing/marketplace-listing/release-by-file'
  | '/develop-plugin/publishing/marketplace-listing/release-overview'
  | '/develop-plugin/publishing/marketplace-listing/release-to-dify-marketplace'
  | '/develop-plugin/publishing/marketplace-listing/release-to-individual-github-repo'
  | '/develop-plugin/publishing/standards/contributor-covenant-code-of-conduct'
  | '/develop-plugin/publishing/standards/privacy-protection-guidelines'
  | '/develop-plugin/publishing/standards/third-party-signature-verification'

// SelfHost paths
type SelfHostPath =
  | '/self-host/deploy/advanced-deployments/local-source-code'
  | '/self-host/deploy/advanced-deployments/start-the-frontend-docker-container'
  | '/self-host/deploy/configuration/environments'
  | '/self-host/deploy/overview'
  | '/self-host/deploy/platform-guides/bt-panel'
  | '/self-host/deploy/platform-guides/dify-premium'
  | '/self-host/deploy/quick-start/docker-compose'
  | '/self-host/deploy/quick-start/faqs'
  | '/self-host/deploy/troubleshooting/common-issues'
  | '/self-host/deploy/troubleshooting/docker-issues'
  | '/self-host/deploy/troubleshooting/integrations'
  | '/self-host/deploy/troubleshooting/storage-and-migration'
  | '/self-host/deploy/troubleshooting/weaviate-v4-migration'
  | '/self-host/use-dify/build/additional-features'
  | '/self-host/use-dify/build/agent'
  | '/self-host/use-dify/build/chatbot'
  | '/self-host/use-dify/build/new-agent/build'
  | '/self-host/use-dify/build/new-agent/overview'
  | '/self-host/use-dify/build/orchestrate-node'
  | '/self-host/use-dify/build/predefined-error-handling-logic'
  | '/self-host/use-dify/build/shortcut-key'
  | '/self-host/use-dify/build/text-generator'
  | '/self-host/use-dify/build/version-control'
  | '/self-host/use-dify/build/workflow-chatflow'
  | '/self-host/use-dify/build/workflow-collaboration'
  | '/self-host/use-dify/debug/error-type'
  | '/self-host/use-dify/debug/history-and-logs'
  | '/self-host/use-dify/debug/step-run'
  | '/self-host/use-dify/debug/variable-inspect'
  | '/self-host/use-dify/getting-started/introduction'
  | '/self-host/use-dify/knowledge/connect-external-knowledge-base'
  | '/self-host/use-dify/knowledge/create-knowledge/chunking-and-cleaning-text'
  | '/self-host/use-dify/knowledge/create-knowledge/import-text-data/readme'
  | '/self-host/use-dify/knowledge/create-knowledge/import-text-data/sync-from-notion'
  | '/self-host/use-dify/knowledge/create-knowledge/import-text-data/sync-from-website'
  | '/self-host/use-dify/knowledge/create-knowledge/introduction'
  | '/self-host/use-dify/knowledge/create-knowledge/setting-indexing-methods'
  | '/self-host/use-dify/knowledge/external-knowledge-api'
  | '/self-host/use-dify/knowledge/integrate-knowledge-within-application'
  | '/self-host/use-dify/knowledge/knowledge-pipeline/authorize-data-source'
  | '/self-host/use-dify/knowledge/knowledge-pipeline/create-knowledge-pipeline'
  | '/self-host/use-dify/knowledge/knowledge-pipeline/knowledge-pipeline-orchestration'
  | '/self-host/use-dify/knowledge/knowledge-pipeline/manage-knowledge-base'
  | '/self-host/use-dify/knowledge/knowledge-pipeline/publish-knowledge-pipeline'
  | '/self-host/use-dify/knowledge/knowledge-pipeline/readme'
  | '/self-host/use-dify/knowledge/knowledge-pipeline/upload-files'
  | '/self-host/use-dify/knowledge/manage-knowledge/introduction'
  | '/self-host/use-dify/knowledge/manage-knowledge/maintain-knowledge-documents'
  | '/self-host/use-dify/knowledge/metadata'
  | '/self-host/use-dify/knowledge/readme'
  | '/self-host/use-dify/knowledge/test-retrieval'
  | '/self-host/use-dify/monitor/analysis'
  | '/self-host/use-dify/monitor/annotation-reply'
  | '/self-host/use-dify/monitor/integrations/integrate-aliyun'
  | '/self-host/use-dify/monitor/integrations/integrate-arize'
  | '/self-host/use-dify/monitor/integrations/integrate-langfuse'
  | '/self-host/use-dify/monitor/integrations/integrate-langsmith'
  | '/self-host/use-dify/monitor/integrations/integrate-opik'
  | '/self-host/use-dify/monitor/integrations/integrate-phoenix'
  | '/self-host/use-dify/monitor/integrations/integrate-weave'
  | '/self-host/use-dify/monitor/logs'
  | '/self-host/use-dify/nodes/agent'
  | '/self-host/use-dify/nodes/answer'
  | '/self-host/use-dify/nodes/code'
  | '/self-host/use-dify/nodes/doc-extractor'
  | '/self-host/use-dify/nodes/http-request'
  | '/self-host/use-dify/nodes/human-input'
  | '/self-host/use-dify/nodes/ifelse'
  | '/self-host/use-dify/nodes/iteration'
  | '/self-host/use-dify/nodes/knowledge-retrieval'
  | '/self-host/use-dify/nodes/list-operator'
  | '/self-host/use-dify/nodes/llm'
  | '/self-host/use-dify/nodes/loop'
  | '/self-host/use-dify/nodes/output'
  | '/self-host/use-dify/nodes/parameter-extractor'
  | '/self-host/use-dify/nodes/question-classifier'
  | '/self-host/use-dify/nodes/start'
  | '/self-host/use-dify/nodes/template'
  | '/self-host/use-dify/nodes/tools'
  | '/self-host/use-dify/nodes/trigger/overview'
  | '/self-host/use-dify/nodes/trigger/plugin-trigger'
  | '/self-host/use-dify/nodes/trigger/schedule-trigger'
  | '/self-host/use-dify/nodes/trigger/webhook-trigger'
  | '/self-host/use-dify/nodes/user-input'
  | '/self-host/use-dify/nodes/variable-aggregator'
  | '/self-host/use-dify/nodes/variable-assigner'
  | '/self-host/use-dify/publish/README'
  | '/self-host/use-dify/publish/publish-mcp'
  | '/self-host/use-dify/publish/publish-to-marketplace'
  | '/self-host/use-dify/publish/webapp/chatflow-webapp'
  | '/self-host/use-dify/publish/webapp/embedding-in-websites'
  | '/self-host/use-dify/publish/webapp/web-app-settings'
  | '/self-host/use-dify/publish/webapp/workflow-webapp'
  | '/self-host/use-dify/workspace/api-extension/api-extension'
  | '/self-host/use-dify/workspace/api-extension/cloudflare-worker'
  | '/self-host/use-dify/workspace/api-extension/external-data-tool-api-extension'
  | '/self-host/use-dify/workspace/api-extension/moderation-api-extension'
  | '/self-host/use-dify/workspace/app-management'
  | '/self-host/use-dify/workspace/model-providers'
  | '/self-host/use-dify/workspace/personal-account-management'
  | '/self-host/use-dify/workspace/plugins'
  | '/self-host/use-dify/workspace/readme'
  | '/self-host/use-dify/workspace/team-members-management'
  | '/self-host/use-dify/workspace/tools'

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
  | CloudPath
  | UseDifyPath
  | HomePath
  | LearnPath
  | QuickStartPath
  | ApiReferencePath
  | CliPath
  | DevelopPluginPath
  | SelfHostPath
  | DeployPath
  | ApiEndpointReferencePath

// Combined path without language prefix (supports optional #anchor)
export type DocPathWithoutLang = DocPathWithoutLangBase | `${DocPathWithoutLangBase}#${string}`

// Product availability for productless docs paths
export const docPathProductAvailability: Record<string, readonly DocsProduct[]> = {
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
  '/deploy/troubleshooting/weaviate-v4-migration': ['self-host'],
  '/use-dify/build/additional-features': ['cloud', 'self-host'],
  '/use-dify/build/agent': ['cloud', 'self-host'],
  '/use-dify/build/chatbot': ['cloud', 'self-host'],
  '/use-dify/build/new-agent/build': ['self-host'],
  '/use-dify/build/new-agent/overview': ['self-host'],
  '/use-dify/build/orchestrate-node': ['cloud', 'self-host'],
  '/use-dify/build/predefined-error-handling-logic': ['cloud', 'self-host'],
  '/use-dify/build/shortcut-key': ['cloud', 'self-host'],
  '/use-dify/build/text-generator': ['cloud', 'self-host'],
  '/use-dify/build/version-control': ['cloud', 'self-host'],
  '/use-dify/build/workflow-chatflow': ['cloud', 'self-host'],
  '/use-dify/build/workflow-collaboration': ['self-host'],
  '/use-dify/debug/error-type': ['cloud', 'self-host'],
  '/use-dify/debug/history-and-logs': ['cloud', 'self-host'],
  '/use-dify/debug/step-run': ['cloud', 'self-host'],
  '/use-dify/debug/variable-inspect': ['cloud', 'self-host'],
  '/use-dify/getting-started/introduction': ['cloud', 'self-host'],
  '/use-dify/knowledge/connect-external-knowledge-base': ['cloud', 'self-host'],
  '/use-dify/knowledge/create-knowledge/chunking-and-cleaning-text': ['cloud', 'self-host'],
  '/use-dify/knowledge/create-knowledge/import-text-data/readme': ['cloud', 'self-host'],
  '/use-dify/knowledge/create-knowledge/import-text-data/sync-from-notion': ['cloud', 'self-host'],
  '/use-dify/knowledge/create-knowledge/import-text-data/sync-from-website': ['cloud', 'self-host'],
  '/use-dify/knowledge/create-knowledge/introduction': ['cloud', 'self-host'],
  '/use-dify/knowledge/create-knowledge/setting-indexing-methods': ['cloud', 'self-host'],
  '/use-dify/knowledge/external-knowledge-api': ['cloud', 'self-host'],
  '/use-dify/knowledge/integrate-knowledge-within-application': ['cloud', 'self-host'],
  '/use-dify/knowledge/knowledge-pipeline/authorize-data-source': ['cloud', 'self-host'],
  '/use-dify/knowledge/knowledge-pipeline/create-knowledge-pipeline': ['cloud', 'self-host'],
  '/use-dify/knowledge/knowledge-pipeline/knowledge-pipeline-orchestration': ['cloud', 'self-host'],
  '/use-dify/knowledge/knowledge-pipeline/manage-knowledge-base': ['cloud', 'self-host'],
  '/use-dify/knowledge/knowledge-pipeline/publish-knowledge-pipeline': ['cloud', 'self-host'],
  '/use-dify/knowledge/knowledge-pipeline/readme': ['cloud', 'self-host'],
  '/use-dify/knowledge/knowledge-pipeline/upload-files': ['cloud', 'self-host'],
  '/use-dify/knowledge/knowledge-request-rate-limit': ['cloud'],
  '/use-dify/knowledge/manage-knowledge/introduction': ['cloud', 'self-host'],
  '/use-dify/knowledge/manage-knowledge/maintain-knowledge-documents': ['cloud', 'self-host'],
  '/use-dify/knowledge/metadata': ['cloud', 'self-host'],
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
  '/use-dify/workspace/app-management': ['cloud', 'self-host'],
  '/use-dify/workspace/model-providers': ['cloud', 'self-host'],
  '/use-dify/workspace/personal-account-management': ['cloud', 'self-host'],
  '/use-dify/workspace/plugins': ['cloud', 'self-host'],
  '/use-dify/workspace/readme': ['cloud', 'self-host'],
  '/use-dify/workspace/subscription-management': ['cloud'],
  '/use-dify/workspace/team-members-management': ['cloud', 'self-host'],
  '/use-dify/workspace/tools': ['cloud', 'self-host'],
}
