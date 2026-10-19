import type { ToolNodeType } from '../types'
import type { CredentialFormSchema } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { NodePanelProps } from '@/app/components/workflow/types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { CollectionType } from '@/app/components/tools/types'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { VarKindType } from '@/app/components/workflow/nodes/_base/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient } from '@/test/console/query-data'
import Panel from '../panel'

const mockUseConfig = vi.hoisted(() => vi.fn())
vi.mock('../hooks/use-config', () => ({ default: (...args: unknown[]) => mockUseConfig(...args) }))
vi.mock('@/app/components/workflow/nodes/_base/hooks/use-available-var-list', () => ({
  default: () => ({ availableVars: [], availableNodesWithParent: [] }),
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

const createSchemaItem = (variable: string): CredentialFormSchema => ({
  name: variable,
  variable,
  label: { en_US: variable, zh_Hans: variable },
  type: FormTypeEnum.textNumber,
  required: false,
  show_on: [],
})

const renderPanel = (
  data: ToolNodeType = createNodeData(),
  definitions: { name: string; schema: Record<string, unknown> }[] = [],
) => {
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(
    consoleQuery.spec.schemaDefinitions.get.queryOptions().queryKey,
    definitions.map((definition) => ({ label: definition.name, ...definition })),
  )
  const props: NodePanelProps<ToolNodeType> = {
    id: 'tool-node-1',
    data,
    panelProps: {
      getInputVars: vi.fn(() => []),
      toVarInputs: vi.fn(() => []),
      runInputData: {},
      runInputDataRef: { current: {} },
      setRunInputData: vi.fn(),
      runResult: null,
    },
  }

  return renderWorkflowFlowComponent(<Panel {...props} />, {
    queryClient,
    nodes: [],
    edges: [],
    resource: { kind: 'knowledge-pipeline', pipelineId: 'pipeline-1' },
  })
}

const createConfigResult = (overrides: Record<string, unknown> = {}) => ({
  readOnly: false,
  inputs: {
    tool_parameters: {},
    tool_configurations: {},
  },
  toolInputVarSchema: [] as CredentialFormSchema[],
  setInputVar: vi.fn(),
  toolSettingSchema: [] as CredentialFormSchema[],
  toolSettingValue: {},
  setToolSettingValue: vi.fn(),
  currCollection: { name: 'google_search' },
  isShowAuthBtn: false,
  isLoading: false,
  outputSchema: [],
  hasObjectOutput: false,
  currTool: { name: 'google_search' },
  ...overrides,
})

describe('ToolPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseConfig.mockReturnValue(createConfigResult())
  })

  describe('Loading State', () => {
    it('should render loading when config data is still loading', () => {
      mockUseConfig.mockReturnValue(
        createConfigResult({
          isLoading: true,
        }),
      )

      renderPanel()

      expect(screen.getByRole('progressbar')).toBeInTheDocument()
      expect(screen.queryByText('workflow.nodes.tool.inputVars')).not.toBeInTheDocument()
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    })
  })

  describe('Form Rendering', () => {
    it('edits input and settings independently and collapses the real settings form', async () => {
      const user = userEvent.setup()
      const setInputVar = vi.fn()
      const setToolSettingValue = vi.fn()
      mockUseConfig.mockReturnValue(
        createConfigResult({
          inputs: { tool_parameters: { count: { type: VarKindType.constant, value: 2 } } },
          toolInputVarSchema: [createSchemaItem('count')],
          toolSettingSchema: [createSchemaItem('limit')],
          toolSettingValue: { limit: { type: VarKindType.constant, value: 10 } },
          setInputVar,
          setToolSettingValue,
        }),
      )
      renderPanel()
      const count = screen.getByRole<HTMLInputElement>('textbox', { name: 'count' })
      await user.click(count)
      count.select()
      await user.paste('3')
      expect(setInputVar).toHaveBeenLastCalledWith({
        count: { type: VarKindType.constant, value: 3 },
      })
      expect(setToolSettingValue).not.toHaveBeenCalled()
      const limit = screen.getByRole<HTMLInputElement>('textbox', { name: 'limit' })
      await user.click(limit)
      limit.select()
      await user.paste('20')
      expect(setToolSettingValue).toHaveBeenLastCalledWith({
        limit: { type: VarKindType.constant, value: 20 },
      })

      await user.click(
        screen.getByRole('button', { name: 'workflow.nodes.tool.settings', expanded: true }),
      )
      expect(screen.queryByRole('textbox', { name: 'limit' })).not.toBeInTheDocument()
      expect(screen.getByRole('textbox', { name: 'count' })).toBeInTheDocument()
    })

    it('should hide editable forms when the auth button is shown but keep output variables visible', async () => {
      const user = userEvent.setup()
      mockUseConfig.mockReturnValue(
        createConfigResult({
          isShowAuthBtn: true,
          toolInputVarSchema: [createSchemaItem('query')],
          toolSettingSchema: [createSchemaItem('region')],
        }),
      )

      renderPanel()

      await user.click(screen.getByRole('button', { name: 'workflow.nodes.common.outputVars' }))

      expect(screen.queryByText('workflow.nodes.tool.inputVars')).not.toBeInTheDocument()
      expect(screen.queryByText('workflow.nodes.tool.settings')).not.toBeInTheDocument()
      expect(screen.getByText('text')).toBeInTheDocument()
      expect(screen.getByText('files')).toBeInTheDocument()
      expect(screen.getByText('json')).toBeInTheDocument()
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    })
  })

  describe('Output Schema', () => {
    it('should render scalar and structured outputs with matched schema types', async () => {
      const user = userEvent.setup()
      mockUseConfig.mockReturnValue(
        createConfigResult({
          hasObjectOutput: true,
          outputSchema: [
            {
              name: 'summary',
              type: 'String',
              description: 'Summary field',
              value: { type: 'string' },
            },
            {
              name: 'details',
              type: 'Object',
              description: 'Details field',
              value: { type: 'object', properties: {} },
            },
          ],
        }),
      )

      renderPanel(createNodeData(), [
        { name: 'qa_structured', schema: { type: 'string' } },
        { name: 'object_structured', schema: { type: 'object', properties: {} } },
      ])

      await user.click(screen.getByRole('button', { name: 'workflow.nodes.common.outputVars' }))

      expect(screen.getByText('summary')).toBeInTheDocument()
      expect(screen.getByText('string (qa_structured)')).toBeInTheDocument()
      expect(screen.getByText('Summary field')).toBeInTheDocument()
      expect(screen.getByText('details')).toBeInTheDocument()
      expect(screen.getByText('object (object_structured)')).toBeInTheDocument()
    })

    it('should render scalar outputs without a schema suffix when no schema type matches', async () => {
      const user = userEvent.setup()
      mockUseConfig.mockReturnValue(
        createConfigResult({
          outputSchema: [
            {
              name: 'summary',
              type: 'String',
              description: 'Summary field',
              value: { type: 'string' },
            },
          ],
        }),
      )

      renderPanel()

      await user.click(screen.getByRole('button', { name: 'workflow.nodes.common.outputVars' }))

      expect(screen.getByText('summary')).toBeInTheDocument()
      expect(screen.queryByText(/qa_structured/)).not.toBeInTheDocument()
    })
  })
})
