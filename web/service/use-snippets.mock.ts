import type { Node } from '@/app/components/workflow/types'
import type { SnippetDetailPayload, SnippetInputField, SnippetListItem } from '@/models/snippet'
import codeDefault from '@/app/components/workflow/nodes/code/default'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import httpDefault from '@/app/components/workflow/nodes/http/default'
import { Method } from '@/app/components/workflow/nodes/http/types'
import llmDefault from '@/app/components/workflow/nodes/llm/default'
import questionClassifierDefault from '@/app/components/workflow/nodes/question-classifier/default'
import { BlockEnum, PromptRole } from '@/app/components/workflow/types'
import { PipelineInputVarType } from '@/models/pipeline'
import { AppModeEnum } from '@/types/app'

const getSnippetListMock = (): SnippetListItem[] => ([
  {
    id: 'snippet-1',
    name: 'Tone Rewriter',
    description: 'Rewrites rough drafts into a concise, professional tone for internal stakeholder updates.',
    author: 'Evan',
    updatedAt: 'Updated 2h ago',
    usage: 'Used 19 times',
    icon: '🪄',
    iconBackground: '#E0EAFF',
    status: 'Draft',
  },
])

const createSnippetMock = (snippetId: string): SnippetListItem => ({
  id: snippetId,
  name: 'Tone Rewriter',
  description: 'Rewrites rough drafts into a concise, professional tone for internal stakeholder updates.',
  author: 'Evan',
  updatedAt: 'Updated 2h ago',
  usage: 'Used 19 times',
  icon: '🪄',
  iconBackground: '#E0EAFF',
  status: 'Draft',
})

const getSnippetInputFieldsMock = (): SnippetInputField[] => ([
  {
    type: PipelineInputVarType.textInput,
    label: 'Blog URL',
    variable: 'blog_url',
    required: true,
    placeholder: 'Paste a source article URL',
    options: [],
    max_length: 256,
  },
  {
    type: PipelineInputVarType.textInput,
    label: 'Target Platforms',
    variable: 'platforms',
    required: true,
    placeholder: 'X, LinkedIn, Instagram',
    options: [],
    max_length: 128,
  },
  {
    type: PipelineInputVarType.textInput,
    label: 'Tone',
    variable: 'tone',
    required: false,
    placeholder: 'Concise and executive-ready',
    options: [],
    max_length: 48,
  },
  {
    type: PipelineInputVarType.textInput,
    label: 'Max Length',
    variable: 'max_length',
    required: false,
    placeholder: 'Set an ideal output length',
    options: [],
    max_length: 48,
  },
])

const getSnippetGraphMock = (): SnippetDetailPayload['graph'] => ({
  viewport: { x: 120, y: 30, zoom: 0.9 },
  nodes: [
    {
      id: 'question-classifier',
      position: { x: 280, y: 208 },
      data: {
        ...questionClassifierDefault.defaultValue,
        title: 'Question Classifier',
        desc: 'After-sales related questions',
        type: BlockEnum.QuestionClassifier,
        query_variable_selector: ['sys', 'query'],
        model: {
          provider: 'openai',
          name: 'gpt-4o',
          mode: AppModeEnum.CHAT,
          completion_params: {
            temperature: 0.2,
          },
        },
        classes: [
          {
            id: '1',
            name: 'HTTP Request',
          },
          {
            id: '2',
            name: 'LLM',
          },
          {
            id: '3',
            name: 'Code',
          },
        ],
      } as unknown as Node['data'],
    },
    {
      id: 'http-request',
      position: { x: 670, y: 72 },
      data: {
        ...httpDefault.defaultValue,
        title: 'HTTP Request',
        desc: 'POST https://api.example.com/content/rewrite',
        type: BlockEnum.HttpRequest,
        method: Method.post,
        url: 'https://api.example.com/content/rewrite',
        headers: 'Content-Type: application/json',
      } as unknown as Node['data'],
    },
    {
      id: 'llm',
      position: { x: 670, y: 248 },
      data: {
        ...llmDefault.defaultValue,
        title: 'LLM',
        desc: 'GPT-4o',
        type: BlockEnum.LLM,
        model: {
          provider: 'openai',
          name: 'gpt-4o',
          mode: AppModeEnum.CHAT,
          completion_params: {
            temperature: 0.7,
          },
        },
        prompt_template: [{
          role: PromptRole.system,
          text: 'Rewrite the content with the requested tone.',
        }],
      } as unknown as Node['data'],
    },
    {
      id: 'code',
      position: { x: 670, y: 424 },
      data: {
        ...codeDefault.defaultValue,
        title: 'Code',
        desc: 'Python',
        type: BlockEnum.Code,
        code_language: CodeLanguage.python3,
        code: 'def main(text: str) -> dict:\n    return {"content": text.strip()}',
      } as unknown as Node['data'],
    },
  ],
  edges: [
    {
      id: 'edge-question-http',
      source: 'question-classifier',
      sourceHandle: '1',
      target: 'http-request',
      targetHandle: 'target',
    },
    {
      id: 'edge-question-llm',
      source: 'question-classifier',
      sourceHandle: '2',
      target: 'llm',
      targetHandle: 'target',
    },
    {
      id: 'edge-question-code',
      source: 'question-classifier',
      sourceHandle: '3',
      target: 'code',
      targetHandle: 'target',
    },
  ],
})

export const getSnippetDetailMock = (snippetId: string): SnippetDetailPayload | null => {
  if (!snippetId)
    return null

  const snippet = getSnippetListMock().find(item => item.id === snippetId) ?? createSnippetMock(snippetId)

  const inputFields = getSnippetInputFieldsMock()

  return {
    snippet,
    graph: getSnippetGraphMock(),
    inputFields,
    uiMeta: {
      inputFieldCount: inputFields.length,
      checklistCount: 2,
      autoSavedAt: 'Auto-saved · a few seconds ago',
    },
  }
}
