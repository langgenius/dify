import type { ToolProviderApiEntityResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { AvailableNodesMetaData } from '../../hooks-store/store'
import type { NodeDefault } from '../../types'
import { waitFor } from '@testing-library/react'
import { createDatasourceProvider } from '@/app/components/rag-pipeline/__tests__/datasource-fixtures'
import { CollectionType } from '@/app/components/tools/types'
import { createToolProviderFixture } from '@/test/console/tool-provider-fixture'
import { createNode } from '../../__tests__/fixtures'
import { renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { BlockClassification } from '../../block-selector/types'
import { BlockEnum } from '../../types'
import { useNodeMetaData } from '../use-nodes-meta-data'

vi.mock('@/context/i18n', () => ({
  useGetLanguage: () => 'en_US',
}))

const buildInToolsState = vi.hoisted(() => [] as ToolProviderApiEntityResponse[])
const customToolsState = vi.hoisted(() => [] as ToolProviderApiEntityResponse[])
const workflowToolsState = vi.hoisted(() => [] as ToolProviderApiEntityResponse[])

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.tools.builtin.get': async () => buildInToolsState,
      'workspaces.current.tools.api.get': async () => customToolsState,
      'workspaces.current.tools.workflow.get': async () => workflowToolsState,
    }),
  }
})

describe('useNodesMetaData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    buildInToolsState.length = 0
    customToolsState.length = 0
    workflowToolsState.length = 0
  })

  it('resolves built-in tool metadata from tool providers', async () => {
    buildInToolsState.push(
      createToolProviderFixture({
        id: 'provider-1',
        author: 'Provider Author',
        description: {
          en_US: 'Built-in provider description',
        },
      }),
    )

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

    await waitFor(() => expect(result.current.author).toBe('Provider Author'))
    expect(result.current).toEqual(
      expect.objectContaining({
        author: 'Provider Author',
        description: 'Built-in provider description',
      }),
    )
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

    const provider = createDatasourceProvider()
    const datasource = createDatasourceProvider({
      plugin_id: 'datasource-1',
      declaration: {
        ...provider.declaration,
        identity: {
          ...provider.declaration.identity,
          author: 'Datasource Author',
          description: { en_US: 'Datasource description', zh_Hans: null },
        },
      },
    })

    const metadataMap: Partial<Record<BlockEnum, NodeDefault>> = {
      [BlockEnum.LLM]: {
        metaData: {
          classification: BlockClassification.Default,
          sort: 0,
          type: BlockEnum.LLM,
          title: 'LLM',
          author: 'Dify',
          description: 'Node description',
        },
        defaultValue: { type: BlockEnum.LLM, title: 'LLM', desc: '' },
        checkValid: () => ({ isValid: true }),
      },
    }

    const datasourceResult = renderWorkflowHook(() => useNodeMetaData(datasourceNode), {
      initialStoreState: {
        dataSourceList: [datasource],
      },
      hooksStoreProps: {
        availableNodesMetaData: {
          nodes: [],
          // This catalog fixture intentionally exposes only the node under test.
          nodesMap: metadataMap as AvailableNodesMetaData['nodesMap'],
        },
      },
    })

    const normalResult = renderWorkflowHook(() => useNodeMetaData(normalNode), {
      hooksStoreProps: {
        availableNodesMetaData: {
          nodes: [],
          // This catalog fixture intentionally exposes only the node under test.
          nodesMap: metadataMap as AvailableNodesMetaData['nodesMap'],
        },
      },
    })

    expect(datasourceResult.result.current).toEqual(
      expect.objectContaining({
        author: 'Datasource Author',
        description: 'Datasource description',
      }),
    )
    expect(normalResult.result.current).toEqual(
      expect.objectContaining({
        author: 'Dify',
        description: 'Node description',
        title: 'LLM',
      }),
    )
  })
})
