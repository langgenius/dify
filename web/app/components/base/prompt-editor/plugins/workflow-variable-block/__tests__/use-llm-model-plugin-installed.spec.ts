import type { WorkflowNodesMap } from '@/app/components/base/prompt-editor/types'
import { renderHook } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
import { useLlmModelPluginInstalled } from '../use-llm-model-plugin-installed'

let mockModelProviders: Array<{ provider: string }> = []

vi.mock('@/context/provider-context', () => ({
  useProviderContextSelector: <T>(selector: (state: { modelProviders: Array<{ provider: string }> }) => T): T =>
    selector({ modelProviders: mockModelProviders }),
}))

const createWorkflowNodesMap = (node: Record<string, unknown>): WorkflowNodesMap =>
  ({
    target: {
      title: 'Target',
      type: BlockEnum.Start,
      ...node,
    },
  } as unknown as WorkflowNodesMap)

describe('useLlmModelPluginInstalled', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockModelProviders = []
  })

  it('should return true when the node is missing', () => {
    const { result } = renderHook(() => useLlmModelPluginInstalled('target', undefined))

    expect(result.current).toBe(true)
  })

  it('should return true when the node is not an LLM node', () => {
    const workflowNodesMap = createWorkflowNodesMap({
      id: 'target',
      type: BlockEnum.Start,
    })

    const { result } = renderHook(() => useLlmModelPluginInstalled('target', workflowNodesMap))

    expect(result.current).toBe(true)
  })

  it('should return true when the matching model plugin is installed', () => {
    mockModelProviders = [
      { provider: 'langgenius/openai/openai' },
      { provider: 'langgenius/anthropic/claude' },
    ]
    const workflowNodesMap = createWorkflowNodesMap({
      id: 'target',
      type: BlockEnum.LLM,
      modelProvider: 'langgenius/openai/gpt-4.1',
    })

    const { result } = renderHook(() => useLlmModelPluginInstalled('target', workflowNodesMap))

    expect(result.current).toBe(true)
  })

  it('should return false when the matching model plugin is not installed', () => {
    mockModelProviders = [
      { provider: 'langgenius/anthropic/claude' },
    ]
    const workflowNodesMap = createWorkflowNodesMap({
      id: 'target',
      type: BlockEnum.LLM,
      modelProvider: 'langgenius/openai/gpt-4.1',
    })

    const { result } = renderHook(() => useLlmModelPluginInstalled('target', workflowNodesMap))

    expect(result.current).toBe(false)
  })
})
