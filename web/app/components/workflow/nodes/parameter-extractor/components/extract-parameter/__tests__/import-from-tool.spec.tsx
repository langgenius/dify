import type { ToolParameter } from '@/app/components/tools/types'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CollectionType } from '@/app/components/tools/types'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { createTool, createToolProvider } from '@/app/components/workflow/block-selector/__tests__/factories'
import ImportFromTool from '../import-from-tool'

vi.mock('reactflow', () => ({
  useStoreApi: () => ({
    getState: () => ({
      getNodes: () => [],
    }),
  }),
}))

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: (selector: (state: { systemFeatures: { enable_marketplace: boolean } }) => unknown) => selector({
    systemFeatures: { enable_marketplace: false },
  }),
}))

vi.mock('@/service/use-plugins', () => ({
  useFeaturedToolsRecommendations: () => ({
    plugins: [],
    isLoading: false,
  }),
}))

const mockToolCollections = vi.hoisted(() => ({
  builtIn: [] as ToolWithProvider[],
  custom: [] as ToolWithProvider[],
  workflow: [] as ToolWithProvider[],
}))

vi.mock('@/service/use-tools', () => ({
  useAllBuiltInTools: () => ({ data: mockToolCollections.builtIn }),
  useAllCustomTools: () => ({ data: mockToolCollections.custom }),
  useAllWorkflowTools: () => ({ data: mockToolCollections.workflow }),
  useAllMCPTools: () => ({ data: [] }),
  useInvalidateAllBuiltInTools: () => vi.fn(),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useLanguage: () => 'en_US',
}))

const createProviderWithTool = (type: CollectionType, providerId: string, toolName: string, toolLabel: string) => createToolProvider({
  id: providerId,
  type,
  tools: [createTool(toolName, toolLabel)],
})

const createToolParameter = (overrides: Partial<ToolParameter> = {}): ToolParameter => ({
  name: 'field',
  label: { en_US: 'Field', zh_Hans: 'Field' },
  human_description: { en_US: 'Field', zh_Hans: 'Field' },
  type: 'string',
  form: 'llm',
  llm_description: 'Field description',
  required: false,
  multiple: false,
  default: '',
  ...overrides,
})

describe('parameter-extractor/extract-parameter/import-from-tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockToolCollections.builtIn = []
    mockToolCollections.custom = []
    mockToolCollections.workflow = []
  })

  it('imports llm parameters from a built-in tool through the real block selector', async () => {
    const user = userEvent.setup()
    const handleImport = vi.fn()
    const provider = createProviderWithTool(CollectionType.builtIn, 'provider-1', 'search', 'Search Tool')
    const builtInParameters = [
      createToolParameter({
        name: 'city',
        required: true,
        llm_description: 'City name',
        label: { en_US: 'City', zh_Hans: 'City' },
        human_description: { en_US: 'City', zh_Hans: 'City' },
        options: [{ value: 'draft', label: { en_US: 'Draft', zh_Hans: 'Draft' } }],
      }),
      createToolParameter({
        name: 'internal_only',
        form: 'form',
        llm_description: 'Should be ignored',
        label: { en_US: 'Internal', zh_Hans: 'Internal' },
        human_description: { en_US: 'Internal', zh_Hans: 'Internal' },
      }),
    ] satisfies ToolWithProvider['tools'][number]['parameters']
    provider.tools[0]!.parameters = builtInParameters
    mockToolCollections.builtIn = [provider]

    renderWorkflowComponent(
      <ImportFromTool onImport={handleImport} />,
      {
        hooksStoreProps: {
          availableNodesMetaData: { nodes: [] },
        },
      },
    )

    await user.click(screen.getByText('workflow.nodes.parameterExtractor.importFromTool'))
    await user.click(await screen.findByText('Provider One'))
    await user.click(await screen.findByText('Search Tool'))

    await waitFor(() => {
      expect(handleImport).toHaveBeenCalledWith([{
        name: 'city',
        type: 'string',
        required: true,
        description: 'City name',
        options: ['Draft'],
      }])
    })
  })

  it('imports llm parameters from workflow tool collections', async () => {
    const user = userEvent.setup()
    const handleImport = vi.fn()
    const provider = createProviderWithTool(CollectionType.workflow, 'workflow-1', 'transform', 'Workflow Tool')
    const workflowParameters = [
      createToolParameter({
        name: 'summary',
        llm_description: 'Summary text',
        label: { en_US: 'Summary', zh_Hans: 'Summary' },
        human_description: { en_US: 'Summary', zh_Hans: 'Summary' },
      }),
    ] satisfies ToolWithProvider['tools'][number]['parameters']
    provider.tools[0]!.parameters = workflowParameters
    mockToolCollections.workflow = [provider]

    renderWorkflowComponent(
      <ImportFromTool onImport={handleImport} />,
      {
        hooksStoreProps: {
          availableNodesMetaData: { nodes: [] },
        },
      },
    )

    await user.click(screen.getByText('workflow.nodes.parameterExtractor.importFromTool'))
    await user.click(await screen.findByText('Workflow Tool'))

    await waitFor(() => {
      expect(handleImport).toHaveBeenCalledWith([{
        name: 'summary',
        type: 'string',
        required: false,
        description: 'Summary text',
        options: [],
      }])
    })
  })
})
