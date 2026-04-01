// GENERATE BY script
// DON NOT EDIT IT MANUALLY
//
// Generated from: https://raw.githubusercontent.com/langgenius/dify-docs/refs/heads/main/docs.json
// Generated at: 2026-03-25T03:18:49.626Z

// Language prefixes
export type DocLanguage = 'en' | 'zh' | 'ja'

// UseDify paths
export type UseDifyPath =
  | '/use-dify/build/additional-features'
  | '/use-dify/build/goto-anything'
  | '/use-dify/build/mcp'
  | '/use-dify/build/orchestrate-node'
  | '/use-dify/build/predefined-error-handling-logic'
  | '/use-dify/build/shortcut-key'
  | '/use-dify/build/version-control'
  | '/use-dify/debug/error-type'
  | '/use-dify/debug/history-and-logs'
  | '/use-dify/debug/step-run'
  | '/use-dify/debug/variable-inspect'
  | '/use-dify/getting-started/introduction'
  | '/use-dify/getting-started/key-concepts'
  | '/use-dify/getting-started/quick-start'
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
  | '/use-dify/knowledge/manage-knowledge/maintain-dataset-via-api'
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
  | '/use-dify/publish/developing-with-apis'
  | '/use-dify/publish/publish-mcp'
  | '/use-dify/publish/publish-to-marketplace'
  | '/use-dify/publish/webapp/chatflow-webapp'
  | '/use-dify/publish/webapp/embedding-in-websites'
  | '/use-dify/publish/webapp/web-app-access'
  | '/use-dify/publish/webapp/web-app-settings'
  | '/use-dify/publish/webapp/workflow-webapp'
  | '/use-dify/tutorials/article-reader'
  | '/use-dify/tutorials/build-ai-image-generation-app'
  | '/use-dify/tutorials/customer-service-bot'
  | '/use-dify/tutorials/simple-chatbot'
  | '/use-dify/tutorials/twitter-chatflow'
  | '/use-dify/tutorials/workflow-101/lesson-01'
  | '/use-dify/tutorials/workflow-101/lesson-02'
  | '/use-dify/tutorials/workflow-101/lesson-03'
  | '/use-dify/tutorials/workflow-101/lesson-04'
  | '/use-dify/tutorials/workflow-101/lesson-05'
  | '/use-dify/tutorials/workflow-101/lesson-06'
  | '/use-dify/tutorials/workflow-101/lesson-07'
  | '/use-dify/tutorials/workflow-101/lesson-08'
  | '/use-dify/tutorials/workflow-101/lesson-09'
  | '/use-dify/tutorials/workflow-101/lesson-10'
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

// UseDify node paths (without prefix)
type ExtractNodesPath<T> = T extends `/use-dify/nodes/${infer Path}` ? Path : never
export type UseDifyNodesPath = ExtractNodesPath<UseDifyPath>

// SelfHost paths
export type SelfHostPath =
  | '/self-host/advanced-deployments/local-source-code'
  | '/self-host/advanced-deployments/start-the-frontend-docker-container'
  | '/self-host/configuration/environments'
  | '/self-host/platform-guides/bt-panel'
  | '/self-host/platform-guides/dify-premium'
  | '/self-host/quick-start/docker-compose'
  | '/self-host/quick-start/faqs'
  | '/self-host/troubleshooting/common-issues'
  | '/self-host/troubleshooting/docker-issues'
  | '/self-host/troubleshooting/integrations'
  | '/self-host/troubleshooting/storage-and-migration'
  | '/self-host/troubleshooting/weaviate-v4-migration'

// DevelopPlugin paths
export type DevelopPluginPath =
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

// API Reference paths (English, use apiReferencePathTranslations for other languages)
export type ApiReferencePath =
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
  | '/api-reference/chats/get-next-suggested-questions'
  | '/api-reference/chats/send-chat-message'
  | '/api-reference/chats/stop-chat-message-generation'
  | '/api-reference/chunks/create-child-chunk'
  | '/api-reference/chunks/create-chunks'
  | '/api-reference/chunks/delete-child-chunk'
  | '/api-reference/chunks/delete-chunk'
  | '/api-reference/chunks/get-chunk'
  | '/api-reference/chunks/list-child-chunks'
  | '/api-reference/chunks/list-chunks'
  | '/api-reference/chunks/update-child-chunk'
  | '/api-reference/chunks/update-chunk'
  | '/api-reference/completions/send-completion-message'
  | '/api-reference/completions/stop-completion-message-generation'
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
  | '/api-reference/documents/update-document-by-file'
  | '/api-reference/documents/update-document-by-text'
  | '/api-reference/documents/update-document-status-in-batch'
  | '/api-reference/end-users/get-end-user-info'
  | '/api-reference/feedback/list-app-feedbacks'
  | '/api-reference/feedback/submit-message-feedback'
  | '/api-reference/files/download-file'
  | '/api-reference/files/upload-file'
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
  | '/api-reference/tts/convert-audio-to-text'
  | '/api-reference/tts/convert-text-to-audio'
  | '/api-reference/workflow-runs/get-workflow-run-detail'
  | '/api-reference/workflow-runs/list-workflow-logs'
  | '/api-reference/workflows/get-workflow-run-detail'
  | '/api-reference/workflows/list-workflow-logs'
  | '/api-reference/workflows/run-workflow'
  | '/api-reference/workflows/run-workflow-by-id'
  | '/api-reference/workflows/stop-workflow-task'

// Base path without language prefix
export type DocPathWithoutLangBase =
  | UseDifyPath
  | SelfHostPath
  | DevelopPluginPath
  | ApiReferencePath

// Combined path without language prefix (supports optional #anchor)
export type DocPathWithoutLang =
  | DocPathWithoutLangBase
  | `${DocPathWithoutLangBase}#${string}`

// Full documentation path with language prefix
export type DifyDocPath = `${DocLanguage}/${DocPathWithoutLang}`

// API Reference path translations (English -> other languages)
export const apiReferencePathTranslations: Record<string, { zh?: string; ja?: string }> = {
  '/api-reference/annotations/configure-annotation-reply': { zh: '/api-reference/标注管理/配置标注回复', ja: '/api-reference/アノテーション管理/アノテーション返信を設定' },
  '/api-reference/annotations/create-annotation': { zh: '/api-reference/标注管理/创建标注', ja: '/api-reference/アノテーション管理/アノテーションを作成' },
  '/api-reference/annotations/delete-annotation': { zh: '/api-reference/标注管理/删除标注', ja: '/api-reference/アノテーション管理/アノテーションを削除' },
  '/api-reference/annotations/get-annotation-reply-job-status': { zh: '/api-reference/标注管理/查询标注回复配置任务状态', ja: '/api-reference/アノテーション管理/アノテーション返信の初期設定タスクステータスを取得' },
  '/api-reference/annotations/list-annotations': { zh: '/api-reference/标注管理/获取标注列表', ja: '/api-reference/アノテーション管理/アノテーションリストを取得' },
  '/api-reference/annotations/update-annotation': { zh: '/api-reference/标注管理/更新标注', ja: '/api-reference/アノテーション管理/アノテーションを更新' },
  '/api-reference/applications/get-app-info': { zh: '/api-reference/应用配置/获取应用基本信息', ja: '/api-reference/アプリケーション設定/アプリケーションの基本情報を取得' },
  '/api-reference/applications/get-app-meta': { zh: '/api-reference/应用配置/获取应用元数据', ja: '/api-reference/アプリケーション設定/アプリケーションのメタ情報を取得' },
  '/api-reference/applications/get-app-parameters': { zh: '/api-reference/应用配置/获取应用参数', ja: '/api-reference/アプリケーション設定/アプリケーションのパラメータ情報を取得' },
  '/api-reference/applications/get-app-webapp-settings': { zh: '/api-reference/应用配置/获取应用-webapp-设置', ja: '/api-reference/アプリケーション設定/アプリの-webapp-設定を取得' },
  '/api-reference/chats/get-next-suggested-questions': { zh: '/api-reference/对话消息/获取下一轮建议问题列表', ja: '/api-reference/チャットメッセージ/次の推奨質問を取得' },
  '/api-reference/chats/send-chat-message': { zh: '/api-reference/对话消息/发送对话消息', ja: '/api-reference/チャットメッセージ/チャットメッセージを送信' },
  '/api-reference/chats/stop-chat-message-generation': { zh: '/api-reference/对话消息/停止响应', ja: '/api-reference/チャットメッセージ/生成を停止' },
  '/api-reference/chunks/create-child-chunk': { zh: '/api-reference/分段/创建子分段', ja: '/api-reference/チャンク/子チャンクを作成' },
  '/api-reference/chunks/create-chunks': { zh: '/api-reference/分段/向文档添加分段', ja: '/api-reference/チャンク/ドキュメントにチャンクを追加' },
  '/api-reference/chunks/delete-child-chunk': { zh: '/api-reference/分段/删除子分段', ja: '/api-reference/チャンク/子チャンクを削除' },
  '/api-reference/chunks/delete-chunk': { zh: '/api-reference/分段/删除文档中的分段', ja: '/api-reference/チャンク/ドキュメント内のチャンクを削除' },
  '/api-reference/chunks/get-chunk': { zh: '/api-reference/分段/获取文档中的分段详情', ja: '/api-reference/チャンク/ドキュメント内のチャンク詳細を取得' },
  '/api-reference/chunks/list-child-chunks': { zh: '/api-reference/分段/获取子分段', ja: '/api-reference/チャンク/子チャンク一覧を取得' },
  '/api-reference/chunks/list-chunks': { zh: '/api-reference/分段/从文档获取分段', ja: '/api-reference/チャンク/チャンク一覧を取得' },
  '/api-reference/chunks/update-child-chunk': { zh: '/api-reference/分段/更新子分段', ja: '/api-reference/チャンク/子チャンクを更新' },
  '/api-reference/chunks/update-chunk': { zh: '/api-reference/分段/更新文档中的分段', ja: '/api-reference/チャンク/ドキュメント内のチャンクを更新' },
  '/api-reference/completions/send-completion-message': { zh: '/api-reference/文本生成/发送消息', ja: '/api-reference/完了メッセージ/完了メッセージを送信' },
  '/api-reference/completions/stop-completion-message-generation': { zh: '/api-reference/文本生成/停止响应', ja: '/api-reference/完了メッセージ/生成を停止' },
  '/api-reference/conversations/delete-conversation': { zh: '/api-reference/会话管理/删除会话', ja: '/api-reference/会話管理/会話を削除' },
  '/api-reference/conversations/list-conversation-messages': { zh: '/api-reference/会话管理/获取会话历史消息', ja: '/api-reference/会話管理/会話履歴メッセージ一覧を取得' },
  '/api-reference/conversations/list-conversation-variables': { zh: '/api-reference/会话管理/获取对话变量', ja: '/api-reference/会話管理/会話変数の取得' },
  '/api-reference/conversations/list-conversations': { zh: '/api-reference/会话管理/获取会话列表', ja: '/api-reference/会話管理/会話一覧を取得' },
  '/api-reference/conversations/rename-conversation': { zh: '/api-reference/会话管理/重命名会话', ja: '/api-reference/会話管理/会話の名前を変更' },
  '/api-reference/conversations/update-conversation-variable': { zh: '/api-reference/会话管理/更新对话变量', ja: '/api-reference/会話管理/会話変数を更新' },
  '/api-reference/documents/create-document-by-file': { zh: '/api-reference/文档/从文件创建文档', ja: '/api-reference/ドキュメント/ファイルからドキュメントを作成' },
  '/api-reference/documents/create-document-by-text': { zh: '/api-reference/文档/从文本创建文档', ja: '/api-reference/ドキュメント/テキストからドキュメントを作成' },
  '/api-reference/documents/delete-document': { zh: '/api-reference/文档/删除文档', ja: '/api-reference/ドキュメント/ドキュメントを削除' },
  '/api-reference/documents/download-document': { zh: '/api-reference/文档/下载文档', ja: '/api-reference/ドキュメント/ドキュメントをダウンロード' },
  '/api-reference/documents/download-documents-as-zip': { zh: '/api-reference/文档/批量下载文档（zip）', ja: '/api-reference/ドキュメント/ドキュメントを一括ダウンロード（zip）' },
  '/api-reference/documents/get-document': { zh: '/api-reference/文档/获取文档详情', ja: '/api-reference/ドキュメント/ドキュメント詳細を取得' },
  '/api-reference/documents/get-document-indexing-status': { zh: '/api-reference/文档/获取文档嵌入状态（进度）', ja: '/api-reference/ドキュメント/ドキュメント埋め込みステータス（進捗）を取得' },
  '/api-reference/documents/list-documents': { zh: '/api-reference/文档/获取知识库的文档列表', ja: '/api-reference/ドキュメント/ナレッジベースのドキュメントリストを取得' },
  '/api-reference/documents/update-document-by-file': { zh: '/api-reference/文档/用文件更新文档', ja: '/api-reference/ドキュメント/ファイルでドキュメントを更新' },
  '/api-reference/documents/update-document-by-text': { zh: '/api-reference/文档/用文本更新文档', ja: '/api-reference/ドキュメント/テキストでドキュメントを更新' },
  '/api-reference/documents/update-document-status-in-batch': { zh: '/api-reference/文档/批量更新文档状态', ja: '/api-reference/ドキュメント/ドキュメントステータスを一括更新' },
  '/api-reference/end-users/get-end-user-info': { zh: '/api-reference/终端用户/获取终端用户', ja: '/api-reference/エンドユーザー/エンドユーザー取得' },
  '/api-reference/feedback/list-app-feedbacks': { zh: '/api-reference/消息反馈/获取应用的消息反馈', ja: '/api-reference/メッセージフィードバック/アプリのフィードバック一覧を取得' },
  '/api-reference/feedback/submit-message-feedback': { zh: '/api-reference/消息反馈/提交消息反馈', ja: '/api-reference/メッセージフィードバック/メッセージフィードバックを送信' },
  '/api-reference/files/download-file': { zh: '/api-reference/文件操作/下载文件', ja: '/api-reference/ファイル操作/ファイルをダウンロード' },
  '/api-reference/files/upload-file': { zh: '/api-reference/文件操作/上传文件', ja: '/api-reference/ファイル操作/ファイルをアップロード' },
  '/api-reference/knowledge-bases/create-an-empty-knowledge-base': { zh: '/api-reference/知识库/创建空知识库', ja: '/api-reference/データセット/空のナレッジベースを作成' },
  '/api-reference/knowledge-bases/delete-knowledge-base': { zh: '/api-reference/知识库/删除知识库', ja: '/api-reference/データセット/ナレッジベースを削除' },
  '/api-reference/knowledge-bases/get-knowledge-base': { zh: '/api-reference/知识库/获取知识库详情', ja: '/api-reference/データセット/ナレッジベース詳細を取得' },
  '/api-reference/knowledge-bases/list-knowledge-bases': { zh: '/api-reference/知识库/获取知识库列表', ja: '/api-reference/データセット/ナレッジベースリストを取得' },
  '/api-reference/knowledge-bases/retrieve-chunks-from-a-knowledge-base-/-test-retrieval': { zh: '/api-reference/知识库/从知识库检索分段-/-测试检索', ja: '/api-reference/データセット/ナレッジベースからチャンクを取得-/-テスト検索' },
  '/api-reference/knowledge-bases/update-knowledge-base': { zh: '/api-reference/知识库/更新知识库', ja: '/api-reference/データセット/ナレッジベースを更新' },
  '/api-reference/knowledge-pipeline/list-datasource-plugins': { zh: '/api-reference/知识流水线/获取数据源插件列表', ja: '/api-reference/ナレッジパイプライン/データソースプラグインリストを取得' },
  '/api-reference/knowledge-pipeline/run-datasource-node': { zh: '/api-reference/知识流水线/执行数据源节点', ja: '/api-reference/ナレッジパイプライン/データソースノードを実行' },
  '/api-reference/knowledge-pipeline/run-pipeline': { zh: '/api-reference/知识流水线/运行流水线', ja: '/api-reference/ナレッジパイプライン/パイプラインを実行' },
  '/api-reference/knowledge-pipeline/upload-pipeline-file': { zh: '/api-reference/知识流水线/上传流水线文件', ja: '/api-reference/ナレッジパイプライン/パイプラインファイルをアップロード' },
  '/api-reference/metadata/create-metadata-field': { zh: '/api-reference/元数据/创建元数据字段', ja: '/api-reference/メタデータ/メタデータフィールドを作成' },
  '/api-reference/metadata/delete-metadata-field': { zh: '/api-reference/元数据/删除元数据字段', ja: '/api-reference/メタデータ/メタデータフィールドを削除' },
  '/api-reference/metadata/get-built-in-metadata-fields': { zh: '/api-reference/元数据/获取内置元数据字段', ja: '/api-reference/メタデータ/組み込みメタデータフィールドを取得' },
  '/api-reference/metadata/list-metadata-fields': { zh: '/api-reference/元数据/获取元数据字段列表', ja: '/api-reference/メタデータ/メタデータフィールドリストを取得' },
  '/api-reference/metadata/update-built-in-metadata-field': { zh: '/api-reference/元数据/更新内置元数据字段', ja: '/api-reference/メタデータ/組み込みメタデータフィールドを更新' },
  '/api-reference/metadata/update-document-metadata-in-batch': { zh: '/api-reference/元数据/批量更新文档元数据', ja: '/api-reference/メタデータ/ドキュメントメタデータを一括更新' },
  '/api-reference/metadata/update-metadata-field': { zh: '/api-reference/元数据/更新元数据字段', ja: '/api-reference/メタデータ/メタデータフィールドを更新' },
  '/api-reference/models/get-available-models': { zh: '/api-reference/模型/获取可用模型', ja: '/api-reference/モデル/利用可能なモデルを取得' },
  '/api-reference/tags/create-knowledge-tag': { zh: '/api-reference/标签/创建知识库标签', ja: '/api-reference/タグ管理/ナレッジベースタグを作成' },
  '/api-reference/tags/create-tag-binding': { zh: '/api-reference/标签/绑定标签到知识库', ja: '/api-reference/タグ管理/タグをデータセットにバインド' },
  '/api-reference/tags/delete-knowledge-tag': { zh: '/api-reference/标签/删除知识库标签', ja: '/api-reference/タグ管理/ナレッジベースタグを削除' },
  '/api-reference/tags/delete-tag-binding': { zh: '/api-reference/标签/解除标签与知识库的绑定', ja: '/api-reference/タグ管理/タグとデータセットのバインドを解除' },
  '/api-reference/tags/get-knowledge-base-tags': { zh: '/api-reference/标签/获取知识库绑定的标签', ja: '/api-reference/タグ管理/ナレッジベースにバインドされたタグを取得' },
  '/api-reference/tags/list-knowledge-tags': { zh: '/api-reference/标签/获取知识库标签列表', ja: '/api-reference/タグ管理/ナレッジベースタグリストを取得' },
  '/api-reference/tags/update-knowledge-tag': { zh: '/api-reference/标签/修改知识库标签', ja: '/api-reference/タグ管理/ナレッジベースタグを変更' },
  '/api-reference/tts/convert-audio-to-text': { zh: '/api-reference/语音与文字转换/语音转文字', ja: '/api-reference/音声・テキスト変換/音声をテキストに変換' },
  '/api-reference/tts/convert-text-to-audio': { zh: '/api-reference/语音与文字转换/文字转语音', ja: '/api-reference/音声・テキスト変換/テキストを音声に変換' },
  '/api-reference/workflow-runs/get-workflow-run-detail': { zh: '/api-reference/工作流执行/获取工作流执行情况', ja: '/api-reference/ワークフロー実行/ワークフロー実行詳細を取得' },
  '/api-reference/workflow-runs/list-workflow-logs': { zh: '/api-reference/工作流执行/获取工作流日志', ja: '/api-reference/ワークフロー実行/ワークフローログ一覧を取得' },
  '/api-reference/workflows/get-workflow-run-detail': { zh: '/api-reference/工作流/获取工作流执行情况', ja: '/api-reference/ワークフロー/ワークフロー実行詳細を取得' },
  '/api-reference/workflows/list-workflow-logs': { zh: '/api-reference/工作流/获取工作流日志', ja: '/api-reference/ワークフロー/ワークフローログ一覧を取得' },
  '/api-reference/workflows/run-workflow': { zh: '/api-reference/工作流/执行工作流', ja: '/api-reference/ワークフロー/ワークフローを実行' },
  '/api-reference/workflows/run-workflow-by-id': { zh: '/api-reference/工作流/按-id-执行工作流', ja: '/api-reference/ワークフロー/id-でワークフローを実行' },
  '/api-reference/workflows/stop-workflow-task': { zh: '/api-reference/工作流/停止工作流任务', ja: '/api-reference/ワークフロー/ワークフロータスクを停止' },
}
