import type { ToolNodeType } from '../../types'
import { renderHook } from '@testing-library/react'
import { CollectionType } from '@/app/components/tools/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { VarType } from '../../types'
import useConfig from '../use-config'

const mockSetInputs = vi.hoisted(() => vi.fn())
const mockSetControlPromptEditorRerenderKey = vi.hoisted(() => vi.fn())
const mockUseCurrentToolCollection = vi.hoisted(() => vi.fn())
const mockGetConfiguredValue = vi.hoisted(() => vi.fn())
const mockToolParametersToFormSchemas = vi.hoisted(() => vi.fn())

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useLanguage: () => 'en_US',
}))

vi.mock('@/app/components/workflow/hooks', () => ({
  useNodesReadOnly: () => ({ nodesReadOnly: false }),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-node-crud', () => ({
  __esModule: true,
  default: (_id: string, data: ToolNodeType) => ({
    inputs: data,
    setInputs: mockSetInputs,
  }),
}))

vi.mock('@/app/components/tools/utils/to-form-schema', () => ({
  getConfiguredValue: (...args: unknown[]) => mockGetConfiguredValue(...args),
  toolParametersToFormSchemas: (...args: unknown[]) => mockToolParametersToFormSchemas(...args),
}))

vi.mock('@/service/tools', () => ({
  updateBuiltInToolCredential: vi.fn(),
}))

vi.mock('@/service/use-tools', () => ({
  useInvalidToolsByType: () => vi.fn(),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({
    getState: () => ({
      setControlPromptEditorRerenderKey: mockSetControlPromptEditorRerenderKey,
    }),
  }),
}))

vi.mock('../use-current-tool-collection', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseCurrentToolCollection(...args),
}))

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
      variable: 'query',
      form: 'llm',
      label: { en_US: 'Query' },
      type: 'string',
      required: true,
      default: 'default query',
    },
    {
      variable: 'api_key',
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
      variable: 'query',
      form: 'llm',
      label: { en_US: 'Query' },
      type: 'string',
      required: true,
    },
    {
      variable: 'api_key',
      form: 'credential',
      label: { en_US: 'API Key' },
      type: 'string',
      required: true,
    },
  ],
}

const createToolVarInput = (value: string) => ({
  type: VarType.mixed,
  value,
})

describe('useConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()

    mockUseCurrentToolCollection.mockReturnValue({
      currCollection: {
        name: 'google_search',
        allow_delete: true,
        is_team_authorization: false,
        tools: [currentTool],
      },
    })

    mockToolParametersToFormSchemas.mockImplementation(parameters => parameters)
    mockGetConfiguredValue.mockImplementation((_value, schema: Array<{ variable: string, default?: string }>) => {
      return schema.reduce<Record<string, ReturnType<typeof createToolVarInput>>>((acc, item) => {
        acc[item.variable] = createToolVarInput(item.default || '')
        return acc
      }, {} as Record<string, ReturnType<typeof createToolVarInput>>)
    })
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  describe('Default Value Sync', () => {
    it('should apply default values only once when the current payload is initially empty', () => {
      const emptyPayload = createNodeData()
      const syncedPayload = createNodeData({
        tool_parameters: { query: createToolVarInput('default query') },
        tool_configurations: { api_key: createToolVarInput('default secret') },
      })

      const { rerender } = renderHook(
        ({ payload }) => useConfig('tool-node-1', payload),
        { initialProps: { payload: emptyPayload } },
      )

      expect(mockSetInputs).toHaveBeenCalledTimes(1)
      expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
        tool_parameters: { query: createToolVarInput('default query') },
        tool_configurations: { api_key: createToolVarInput('default secret') },
      }))

      rerender({ payload: syncedPayload })

      expect(mockSetInputs).toHaveBeenCalledTimes(1)
    })

    it('should not update inputs when tool values are already populated on first render', () => {
      renderHook(() => useConfig('tool-node-1', createNodeData({
        tool_parameters: { query: createToolVarInput('existing query') },
        tool_configurations: { api_key: createToolVarInput('existing secret') },
      })))

      expect(mockSetInputs).not.toHaveBeenCalled()
    })

    it('should not update inputs when empty schemas do not provide any default values', () => {
      mockUseCurrentToolCollection.mockReturnValue({
        currCollection: {
          name: 'google_search',
          allow_delete: true,
          is_team_authorization: false,
          tools: [currentToolWithoutDefaults],
        },
      })
      mockGetConfiguredValue.mockReturnValue({})

      renderHook(() => useConfig('tool-node-1', createNodeData()))

      expect(mockSetInputs).not.toHaveBeenCalled()
    })
  })
})
