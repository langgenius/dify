import type { LLMNodeType } from '../types'
import type { InputVar, Variable } from '@/app/components/workflow/types'
import { renderHook } from '@testing-library/react'
import {
  BlockEnum,
  EditionType,
  InputVarType,
  PromptRole,
  VarType,
} from '@/app/components/workflow/types'
import { AppModeEnum } from '@/types/app'
import { FlowType } from '@/types/common'
import useConfigVision from '../../../hooks/use-config-vision'
import useAvailableVarList from '../../_base/hooks/use-available-var-list'
import useNodeCrud from '../../_base/hooks/use-node-crud'
import useSingleRunFormParams from '../use-single-run-form-params'

vi.mock('../../../hooks/use-config-vision', () => ({
  __esModule: true,
  default: vi.fn(),
}))

vi.mock('../../_base/hooks/use-available-var-list', () => ({
  __esModule: true,
  default: vi.fn(),
}))

vi.mock('../../_base/hooks/use-node-crud', () => ({
  __esModule: true,
  default: vi.fn(),
}))

vi.mock('@/app/components/workflow/hooks', () => ({
  useIsChatMode: () => true,
}))

const mockFlowType = vi.hoisted(() => ({
  value: undefined as FlowType | undefined,
}))

vi.mock('@/app/components/workflow/hooks-store/store', () => ({
  useHooksStore: (selector: (state: { configsMap?: { flowType?: FlowType } }) => unknown) =>
    selector({
      configsMap: {
        flowType: mockFlowType.value,
      },
    }),
}))

const mockUseConfigVision = vi.mocked(useConfigVision)
const mockUseAvailableVarList = vi.mocked(useAvailableVarList)
const mockUseNodeCrud = vi.mocked(useNodeCrud)

const createData = (overrides: Partial<LLMNodeType> = {}): LLMNodeType => ({
  title: 'LLM',
  desc: '',
  type: BlockEnum.LLM,
  model: {
    provider: 'openai',
    name: 'gpt-4o',
    mode: AppModeEnum.CHAT,
    completion_params: {},
  } as LLMNodeType['model'],
  prompt_template: [
    {
      edition_type: EditionType.basic,
      role: PromptRole.user,
      text: '{{#start.query#}}',
    },
  ],
  memory: {
    window: {
      enabled: false,
      size: 50,
    },
    query_prompt_template: '{{#sys.query#}}\n{{#sys.files#}}',
  },
  context: {
    enabled: false,
    variable_selector: [],
  },
  vision: {
    enabled: false,
  },
  ...overrides,
})

const createInputVar = (variable: string): InputVar => ({
  label: variable,
  variable,
  type: InputVarType.textInput,
  required: false,
})

describe('llm/use-single-run-form-params', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFlowType.value = undefined
    mockUseNodeCrud.mockImplementation(
      (_id, payload) =>
        ({
          inputs: payload,
          setInputs: vi.fn(),
        }) as unknown as ReturnType<typeof useNodeCrud>,
    )
    mockUseConfigVision.mockReturnValue({
      isVisionModel: false,
    } as ReturnType<typeof useConfigVision>)
    mockUseAvailableVarList.mockReturnValue({
      availableVars: [],
    } as unknown as ReturnType<typeof useAvailableVarList>)
  })

  it('filters system variables from single-run inputs in snippet flows', () => {
    mockFlowType.value = FlowType.snippet
    const getInputVars = vi.fn(() => [
      createInputVar('#start.query#'),
      createInputVar('#sys.query#'),
      createInputVar('#sys.files#'),
    ])
    const toVarInputs = vi.fn((_variables: Variable[]) => [
      createInputVar('#sys.workflow_id#'),
      createInputVar('#start.extra#'),
    ])

    const { result } = renderHook(() =>
      useSingleRunFormParams({
        id: 'llm-node',
        payload: createData({
          prompt_template: [
            {
              edition_type: EditionType.jinja2,
              role: PromptRole.user,
              text: '{{ query }}',
            },
          ],
          prompt_config: {
            jinja2_variables: [
              {
                variable: 'extra',
                value_selector: ['start', 'extra'],
                value_type: VarType.string,
              },
            ],
          },
        }),
        runInputData: {},
        runInputDataRef: { current: {} },
        getInputVars,
        setRunInputData: vi.fn(),
        toVarInputs,
      }),
    )

    expect(result.current.forms[0]!.inputs).toEqual([
      expect.objectContaining({
        variable: '#start.query#',
      }),
      expect.objectContaining({
        variable: '#start.extra#',
      }),
    ])
  })
})
