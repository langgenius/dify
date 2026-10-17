import type { ParameterExtractorNodeType } from '../types'
import type { PanelProps } from '@/types/workflow'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum } from '@/app/components/workflow/types'
import Panel from '../panel'
import { ParamType, ReasoningModeType } from '../types'
import useConfig from '../use-config'

// These independent editors are outside the parameter-dialog integration under test.
vi.mock(
  '@/app/components/header/account-setting/model-provider-page/model-parameter-modal',
  () => ({ default: () => null }),
)
vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-reference-picker', () => ({
  default: () => null,
}))
vi.mock('@/app/components/workflow/nodes/_base/components/config-vision', () => ({
  default: () => null,
}))
vi.mock('@/app/components/workflow/nodes/_base/components/prompt/editor', () => ({
  default: () => null,
}))
vi.mock('../components/extract-parameter/import-from-tool', () => ({ default: () => null }))

vi.mock('../use-config', () => ({
  __esModule: true,
  default: vi.fn(),
}))

const mockUseConfig = vi.mocked(useConfig)

const createData = (
  overrides: Partial<ParameterExtractorNodeType> = {},
): ParameterExtractorNodeType => ({
  title: 'Parameter Extractor',
  desc: '',
  type: BlockEnum.ParameterExtractor,
  model: {
    provider: 'openai',
    name: 'gpt-4o',
    mode: 'chat' as const,
    completion_params: {},
  } as ParameterExtractorNodeType['model'],
  query: ['node-1', 'query'],
  reasoning_mode: ReasoningModeType.prompt,
  parameters: [
    {
      name: 'city',
      type: ParamType.string,
      description: 'City name',
      required: false,
    },
  ],
  instruction: 'Extract city and budget',
  vision: {
    enabled: false,
  },
  ...overrides,
})

const panelProps = {} as PanelProps

describe('parameter-extractor/panel', () => {
  const handleModelChanged = vi.fn()
  const handleCompletionParamsChange = vi.fn()
  const handleInputVarChange = vi.fn()
  const handleVisionResolutionEnabledChange = vi.fn()
  const handleVisionResolutionChange = vi.fn()
  const handleImportFromTool = vi.fn()
  const addExtractParameter = vi.fn()
  const handleInstructionChange = vi.fn()
  const handleMemoryChange = vi.fn()
  const handleReasoningModeChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseConfig.mockReturnValue({
      readOnly: false,
      handleInputVarChange,
      filterVar: vi.fn(() => true),
      isChatflow: true,
      inputs: createData(),
      isChatModel: true,
      isCompletionModel: false,
      handleModelChanged,
      handleCompletionParamsChange,
      handleImportFromTool,
      handleExactParamsChange: vi.fn(),
      addExtractParameter,
      handleInstructionChange,
      hasSetBlockStatus: { history: false, query: false, context: false },
      availableVars: [],
      availableNodesWithParent: [],
      isSupportFunctionCall: true,
      handleReasoningModeChange,
      handleMemoryChange,
      isVisionModel: true,
      handleVisionResolutionEnabledChange,
      handleVisionResolutionChange,
    } as ReturnType<typeof useConfig>)
  })

  it('adds a parameter through the real dialog and closes it after submission', async () => {
    const user = userEvent.setup()

    render(<Panel id="node-1" data={createData()} panelProps={panelProps} />)

    await user.click(
      screen.getByRole('button', {
        name: 'workflowModels.nodes.parameterExtractor.addExtractParameter',
      }),
    )
    await user.type(
      screen.getByRole('textbox', {
        name: 'workflowModels.nodes.parameterExtractor.addExtractParameterContent.name',
      }),
      'budget',
    )
    await user.type(
      screen.getByRole('textbox', {
        name: 'workflowModels.nodes.parameterExtractor.addExtractParameterContent.description',
      }),
      'Budget amount',
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.add' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(addExtractParameter).toHaveBeenCalledExactlyOnceWith(
      {
        name: 'budget',
        type: ParamType.string,
        description: 'Budget amount',
        required: false,
      },
      undefined,
    )
  })
})
