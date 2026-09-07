export const agentBuilderPreseededResources = {
  stableChatModel: 'E2E Stable Chat Model',
  speechToTextModel: 'Workspace default Speech-to-Text model',
  summarySkill: 'e2e-summary-skill',
  jsonReplaceTool: 'JSON Process / JSON Replace',
  tavilySearchTool: 'Tavily / Tavily Search',
  agentKnowledgeBase: 'E2E Agent Knowledge Base',
  agentDecisionChatModel: 'E2E Agent Decision Chat Model',
  fullConfigAgent: 'E2E New Agent Builder Full Config',
  toolStatesAgent: 'E2E New Agent Builder Tool States',
  dualRetrievalAgent: 'E2E Agent With Dual Retrieval',
  workflowReferenceAgent: 'E2E Agent With Workflow Reference',
  referenceWorkflow: 'E2E Agent Reference Workflow',
} as const

export const agentBuilderFixedInputs = {
  tavilyInvalidApiKey: 'E2E_INVALID_TAVILY_API_KEY_DO_NOT_USE',
  missingSkillSearch: 'E2E_NOT_EXIST_SKILL',
  missingToolSearch: 'E2E_NOT_EXIST_TOOL',
  missingToolSearchWithSuffix: 'E2E_NOT_EXIST_TOOL_12345',
  customKnowledgeQuery: 'Dify Agent E2E knowledge marker',
  knowledgeRuntimeQuery:
    'Use the connected knowledge source to find the Dify Agent E2E knowledge marker.',
  envPlainKey: 'E2E_AGENT_FLAG',
  envPlainValue: 'enabled',
  envModeKey: 'E2E_AGENT_MODE',
  envModeValue: 'plain',
  envAfterInvalidImportKey: 'E2E_AGENT_AFTER_INVALID',
  envAfterInvalidImportValue: 'still-valid',
  backendApiUser: 'e2e-agent-access-point',
} as const

export const agentBuilderExpectedTokens = {
  agentReply: 'AGENT_E2E_PASS',
  updatedAgentReply: 'E2E_AGENT_UPDATED',
  knowledgeReply: 'AGENT_KNOWLEDGE_PASS',
  jsonToolBefore: 'JSON_TOOL_E2E',
  jsonToolAfter: 'E2E_AFTER',
} as const
