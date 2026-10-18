import type { ToolNodeType } from '../../types'
import { act, waitFor } from '@testing-library/react'
import { CollectionType } from '@/app/components/tools/types'
import { VarKindType } from '@/app/components/workflow/nodes/_base/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { renderNodeConfig } from '../../../__tests__/render-node-config'
import useConfig from '../use-config'

const mockUseCurrentToolCollection = vi.hoisted(() => vi.fn())
vi.mock('../use-current-tool-collection', () => ({ default: () => mockUseCurrentToolCollection() }))

const createNodeData = (overrides: Partial<ToolNodeType> = {}): ToolNodeType => ({
  title: 'Google Search',
  desc: '',
  type: BlockEnum.Tool,
  provider_id: 'google_search',
  provider_type: CollectionType.builtIn,
  provider_name: 'Google Search',
  tool_name: 'google_search',
  tool_label: 'Google Search',
  tool_parameters: {},
  tool_configurations: {},
  ...overrides,
})

const currentTool = {
  name: 'google_search',
  parameters: [
    {
      name: 'query',
      form: 'llm',
      label: { en_US: 'Query' },
      type: 'string',
      required: true,
      default: 'default query',
    },
    {
      name: 'api_key',
      form: 'credential',
      label: { en_US: 'API Key' },
      type: 'string',
      required: true,
      default: 'default secret',
    },
  ],
}

const currentToolWithoutDefaults = {
  name: 'google_search',
  parameters: [
    {
      name: 'query',
      form: 'llm',
      label: { en_US: 'Query' },
      type: 'string',
      required: true,
    },
    {
      name: 'api_key',
      form: 'credential',
      label: { en_US: 'API Key' },
      type: 'string',
      required: true,
    },
  ],
}

const createToolVarInput = (value: string) => ({
  type: VarKindType.mixed,
  value,
})

describe('tool default configuration', () => {
  beforeEach(() => {
    mockUseCurrentToolCollection.mockReturnValue({
      currCollection: {
        name: 'google_search',
        allow_delete: true,
        is_team_authorization: false,
        tools: [currentTool],
      },
    })
  })

  it('persists defaults to the graph and preserves subsequent user edits', async () => {
    const { result } = renderNodeConfig(useConfig, createNodeData())
    await waitFor(() =>
      expect(result.current.flow.getNode('node')?.data).toMatchObject({
        tool_parameters: { query: createToolVarInput('default query') },
        tool_configurations: { api_key: createToolVarInput('default secret') },
      }),
    )
    act(() => result.current.config.setInputVar({ query: createToolVarInput('Edited query') }))
    expect(result.current.flow.getNode('node')?.data).toMatchObject({
      tool_parameters: { query: createToolVarInput('Edited query') },
      tool_configurations: { api_key: createToolVarInput('default secret') },
    })
  })

  it('preserves existing values when opening configuration', () => {
    const payload = createNodeData({
      tool_parameters: { query: createToolVarInput('existing query') },
      tool_configurations: { api_key: createToolVarInput('existing secret') },
    })
    const { result } = renderNodeConfig(useConfig, payload)
    expect(result.current.flow.getNode('node')?.data).toMatchObject(payload)
  })

  it('leaves empty parameters unconfigured when the tool supplies no defaults', () => {
    mockUseCurrentToolCollection.mockReturnValue({
      currCollection: {
        name: 'google_search',
        allow_delete: true,
        is_team_authorization: false,
        tools: [currentToolWithoutDefaults],
      },
    })
    const { result } = renderNodeConfig(useConfig, createNodeData())
    expect(result.current.flow.getNode('node')?.data).toMatchObject({
      tool_parameters: {},
      tool_configurations: {},
    })
  })
})
