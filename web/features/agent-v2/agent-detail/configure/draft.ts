import type { AgentComposerDraft } from '@/features/agent-v2/agent-composer/store'
import {
  defaultAgentFiles,
  defaultAgentKnowledgeRetrievals,
  defaultAgentSkills,
  defaultAgentTools,
} from './components/data'

export const defaultAgentConfigureDraft: AgentComposerDraft = {
  prompt: '',
  skills: defaultAgentSkills,
  files: defaultAgentFiles,
  tools: defaultAgentTools,
  knowledgeRetrievals: defaultAgentKnowledgeRetrievals,
  envVariables: [
    {
      id: 'openai-api-key',
      key: 'OPENAI_API_KEY',
      value: '••••••••••••',
      scope: 'secret',
      masked: true,
    },
    {
      id: 'tender-corpus-id',
      key: 'TENDER_CORPUS_ID',
      value: 'tender-corpus-2025',
      scope: 'plain',
    },
  ],
  toolSettings: {},
}
