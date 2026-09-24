import type { ToolParameter } from '@/app/components/tools/types'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CollectionType } from '@/app/components/tools/types'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import {
  createTool,
  createToolProvider,
} from '@/app/components/workflow/block-selector/__tests__/factories'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import ImportFromTool from '../import-from-tool'

vi.mock('reactflow', () => ({
  useStoreApi: () => ({
    getState: () => ({
      getNodes: () => [],
    }),
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

const createProviderWithTool = (
  type: CollectionType,
  providerId: string,
  toolName: string,
  toolLabel: string,
) =>
  createToolProvider({
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

const renderImportFromTool = (ui: React.ReactElement) => {
  const { wrapper: ConsoleQueryWrapper } = createConsoleQueryWrapper({
    systemFeatures: { enable_marketplace: false },
  })
  return renderWorkflowComponent(<ConsoleQueryWrapper>{ui}</ConsoleQueryWrapper>, {
    hooksStoreProps: {
      availableNodesMetaData: { nodes: [] },
    },
  })
}

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
    const provider = createProviderWithTool(
      CollectionType.builtIn,
      'provider-1',
      'search',
      'Search Tool',
    )
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

    renderImportFromTool(<ImportFromTool onImport={handleImport} />)

    await user.click(screen.getByText('workflow.nodes.parameterExtractor.importFromTool'))
    await user.click(await screen.findByText('Provider One'))
    await user.click(await screen.findByText('Search Tool'))

    await waitFor(() => {
      expect(handleImport).toHaveBeenCalledWith([
        {
          name: 'city',
          type: 'string',
          required: true,
          description: 'City name',
          options: ['Draft'],
        },
      ])
    })
  })

  it.each([
    {
      collectionType: CollectionType.custom,
      providerId: 'custom-1',
      toolName: 'lookup',
      toolLabel: 'Custom Tool',
      parameterName: 'record_id',
      description: 'Record identifier',
    },
    {
      collectionType: CollectionType.workflow,
      providerId: 'workflow-1',
      toolName: 'transform',
      toolLabel: 'Workflow Tool',
      parameterName: 'summary',
      description: 'Summary text',
    },
  ])(
    'imports llm parameters from $collectionType tool collections',
    async ({ collectionType, providerId, toolName, toolLabel, parameterName, description }) => {
      const user = userEvent.setup()
      const handleImport = vi.fn()
      const provider = createProviderWithTool(collectionType, providerId, toolName, toolLabel)
      const parameters = [
        createToolParameter({
          name: parameterName,
          llm_description: description,
          label: { en_US: parameterName, zh_Hans: parameterName },
          human_description: { en_US: description, zh_Hans: description },
        }),
      ] satisfies ToolWithProvider['tools'][number]['parameters']
      provider.tools[0]!.parameters = parameters
      mockToolCollections[collectionType === CollectionType.custom ? 'custom' : 'workflow'] = [
        provider,
      ]

      renderImportFromTool(<ImportFromTool onImport={handleImport} />)

      await user.click(screen.getByText('workflow.nodes.parameterExtractor.importFromTool'))
      if (collectionType === CollectionType.custom) {
        await user.click(screen.getByRole('button', { name: 'workflow.tabs.customTool' }))
        await user.click(screen.getByText('Provider One'))
      }
      await user.click(await screen.findByText(toolLabel))

      await waitFor(() => {
        expect(handleImport).toHaveBeenCalledWith([
          {
            name: parameterName,
            type: 'string',
            required: false,
            description,
            options: [],
          },
        ])
      })
    },
  )
})
