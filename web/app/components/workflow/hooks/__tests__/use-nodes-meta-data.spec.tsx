import type { Node } from '../../types'
import { CollectionType } from '@/app/components/tools/types'
import { renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { BlockEnum } from '../../types'
import { useNodeMetaData, useNodesMetaData } from '../use-nodes-meta-data'

const buildInToolsState = vi.hoisted(() => [] as Array<{ id: string, author: string, description: Record<string, string> }>)
const customToolsState = vi.hoisted(() => [] as Array<{ id: string, author: string, description: Record<string, string> }>)
const workflowToolsState = vi.hoisted(() => [] as Array<{ id: string, author: string, description: Record<string, string> }>)

vi.mock('@/context/i18n', () => ({
  useGetLanguage: () => 'en-US',
}))

vi.mock('@/service/use-tools', () => ({
  useAllBuiltInTools: () => ({ data: buildInToolsState }),
  useAllCustomTools: () => ({ data: customToolsState }),
  useAllWorkflowTools: () => ({ data: workflowToolsState }),
}))

const createNode = (overrides: Partial<Node> = {}): Node => ({
  id: 'node-1',
  type: 'custom',
  position: { x: 0, y: 0 },
  data: {
    type: BlockEnum.LLM,
    title: 'Node',
    desc: '',
  },
  ...overrides,
} as Node)

describe('useNodesMetaData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    buildInToolsState.length = 0
    customToolsState.length = 0
    workflowToolsState.length = 0
  })

  it('returns empty metadata collections when the hooks store has no node map', () => {
    const { result } = renderWorkflowHook(() => useNodesMetaData(), {
      hooksStoreProps: {},
    })

    expect(result.current).toEqual({
      nodes: [],
      nodesMap: {},
    })
  })

  it('resolves built-in tool metadata from tool providers', () => {
    buildInToolsState.push({
      id: 'provider-1',
      author: 'Provider Author',
      description: {
        'en-US': 'Built-in provider description',
      },
    })

    const toolNode = createNode({
      data: {
        type: BlockEnum.Tool,
        title: 'Tool Node',
        desc: '',
        provider_type: CollectionType.builtIn,
        provider_id: 'provider-1',
      },
    })

    const { result } = renderWorkflowHook(() => useNodeMetaData(toolNode), {
      hooksStoreProps: {
        availableNodesMetaData: {
          nodes: [],
        },
      },
    })

    expect(result.current).toEqual(expect.objectContaining({
      author: 'Provider Author',
      description: 'Built-in provider description',
    }))
  })

  it('prefers workflow store data for datasource nodes and keeps generic metadata for normal blocks', () => {
    const datasourceNode = createNode({
      data: {
        type: BlockEnum.DataSource,
        title: 'Dataset',
        desc: '',
        plugin_id: 'datasource-1',
      },
    })

    const normalNode = createNode({
      data: {
        type: BlockEnum.LLM,
        title: 'Writer',
        desc: '',
      },
    })

    const datasource = {
      plugin_id: 'datasource-1',
      author: 'Datasource Author',
      description: {
        'en-US': 'Datasource description',
      },
    }

    const metadataMap = {
      [BlockEnum.LLM]: {
        metaData: {
          type: BlockEnum.LLM,
          title: 'LLM',
          author: 'Dify',
          description: 'Node description',
        },
      },
    }

    const datasourceResult = renderWorkflowHook(() => useNodeMetaData(datasourceNode), {
      initialStoreState: {
        dataSourceList: [datasource as never],
      },
      hooksStoreProps: {
        availableNodesMetaData: {
          nodes: [],
          nodesMap: metadataMap as never,
        },
      },
    })

    const normalResult = renderWorkflowHook(() => useNodeMetaData(normalNode), {
      hooksStoreProps: {
        availableNodesMetaData: {
          nodes: [],
          nodesMap: metadataMap as never,
        },
      },
    })

    expect(datasourceResult.result.current).toEqual(expect.objectContaining({
      author: 'Datasource Author',
      description: 'Datasource description',
    }))
    expect(normalResult.result.current).toEqual(expect.objectContaining({
      author: 'Dify',
      description: 'Node description',
      title: 'LLM',
    }))
  })
})
