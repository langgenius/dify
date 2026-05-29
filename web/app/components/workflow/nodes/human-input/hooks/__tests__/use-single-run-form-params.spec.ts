import type { HumanInputNodeType } from '../../types'
import type { InputVar } from '@/app/components/workflow/types'
import type { HumanInputFormData } from '@/types/workflow'
import { act, renderHook } from '@testing-library/react'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import { AppModeEnum } from '@/types/app'
import useSingleRunFormParams from '../use-single-run-form-params'

const mockUseTranslation = vi.hoisted(() => vi.fn())
const mockUseAppStore = vi.hoisted(() => vi.fn())
const mockFetchHumanInputNodeStepRunForm = vi.hoisted(() => vi.fn())
const mockSubmitHumanInputNodeStepRunForm = vi.hoisted(() => vi.fn())
const mockUseNodeCrud = vi.hoisted(() => vi.fn())

vi.mock('react-i18next', () => ({
  useTranslation: () => mockUseTranslation(),
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: { appDetail?: { id?: string, mode?: AppModeEnum } }) => unknown) => mockUseAppStore(selector),
}))

vi.mock('@/service/workflow', () => ({
  fetchHumanInputNodeStepRunForm: (...args: unknown[]) => mockFetchHumanInputNodeStepRunForm(...args),
  submitHumanInputNodeStepRunForm: (...args: unknown[]) => mockSubmitHumanInputNodeStepRunForm(...args),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-node-crud', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseNodeCrud(...args),
}))

const createPayload = (overrides: Partial<HumanInputNodeType> = {}): HumanInputNodeType => ({
  title: 'Human Input',
  desc: '',
  type: BlockEnum.HumanInput,
  delivery_methods: [],
  form_content: 'Summary: {{#start.topic#}}',
  inputs: [{
    type: InputVarType.textInput,
    output_variable_name: 'summary',
    default: {
      type: 'variable',
      selector: ['start', 'topic'],
      value: '',
    },
  }],
  user_actions: [],
  timeout: 1,
  timeout_unit: 'day',
  ...overrides,
})

const createInputVar = (overrides: Partial<InputVar> = {}): InputVar => ({
  type: InputVarType.textInput,
  label: 'Topic',
  variable: '#start.topic#',
  required: false,
  value_selector: ['start', 'topic'],
  ...overrides,
})

const mockFormData: HumanInputFormData = {
  form_id: 'form-1',
  node_id: 'node-1',
  node_title: 'Human Input',
  form_content: 'Rendered content',
  inputs: [],
  actions: [],
  form_token: 'token-1',
  resolved_default_values: {
    topic: 'AI',
  },
  display_in_ui: true,
  expiration_time: 1000,
}

describe('human-input/hooks/use-single-run-form-params', () => {
  const mockSetRunInputData = vi.fn()
  const getInputVars = vi.fn()
  let currentInputs = createPayload()
  let appDetail: { id?: string, mode?: AppModeEnum } | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    currentInputs = createPayload()
    appDetail = {
      id: 'app-1',
      mode: AppModeEnum.WORKFLOW,
    }

    mockUseTranslation.mockReturnValue({
      t: (key: string) => key,
    })
    mockUseAppStore.mockImplementation((selector: (state: { appDetail?: { id?: string, mode?: AppModeEnum } }) => unknown) => selector({ appDetail }))
    mockUseNodeCrud.mockImplementation(() => ({
      inputs: currentInputs,
    }))
    getInputVars.mockReturnValue([
      createInputVar(),
      createInputVar({
        label: 'Output',
        variable: '#$output.answer#',
        value_selector: ['$output', 'answer'],
      }),
      {
        ...createInputVar({
          label: 'Broken',
        }),
        variable: undefined,
      } as unknown as InputVar,
    ])
    mockFetchHumanInputNodeStepRunForm.mockResolvedValue(mockFormData)
    mockSubmitHumanInputNodeStepRunForm.mockResolvedValue({})
  })

  it('should build a single before-run form, filter output vars, and expose dependent vars', () => {
    const { result } = renderHook(() => useSingleRunFormParams({
      id: 'node-1',
      payload: currentInputs,
      runInputData: { topic: 'AI' },
      getInputVars,
      setRunInputData: mockSetRunInputData,
    }))

    expect(getInputVars).toHaveBeenCalledWith([
      '{{#start.topic#}}',
      'Summary: {{#start.topic#}}',
    ])
    expect(result.current.forms).toHaveLength(1)
    expect(result.current.forms[0]).toEqual(expect.objectContaining({
      label: 'nodes.humanInput.singleRun.label',
      values: { topic: 'AI' },
      inputs: [
        expect.objectContaining({ variable: '#start.topic#' }),
        expect.objectContaining({ label: 'Broken' }),
      ],
    }))

    act(() => {
      result.current.forms[0]!.onChange?.({ topic: 'Updated' })
    })

    expect(mockSetRunInputData).toHaveBeenCalledWith({ topic: 'Updated' })
    expect(result.current.getDependentVars()).toEqual([
      ['start', 'topic'],
    ])
  })

  it('should fetch and submit generated forms in workflow mode while keeping required inputs', async () => {
    const { result } = renderHook(() => useSingleRunFormParams({
      id: 'node-1',
      payload: currentInputs,
      runInputData: {},
      getInputVars,
      setRunInputData: mockSetRunInputData,
    }))

    await act(async () => {
      await result.current.handleShowGeneratedForm({
        topic: 'AI',
        ignored: undefined as unknown as string,
      })
    })

    expect(result.current.showGeneratedForm).toBe(true)
    expect(mockFetchHumanInputNodeStepRunForm).toHaveBeenCalledWith(
      '/apps/app-1/workflows/draft/human-input/nodes/node-1/form',
      {
        inputs: { topic: 'AI' },
      },
    )
    expect(result.current.formData).toEqual(mockFormData)

    await act(async () => {
      await result.current.handleSubmitHumanInputForm({
        inputs: { answer: 'approved' },
        form_inputs: { ignored: 'value' },
        action: 'approve',
      })
    })

    expect(mockSubmitHumanInputNodeStepRunForm).toHaveBeenCalledWith(
      '/apps/app-1/workflows/draft/human-input/nodes/node-1/form',
      {
        inputs: { topic: 'AI' },
        form_inputs: { answer: 'approved' },
        action: 'approve',
      },
    )

    act(() => {
      result.current.handleHideGeneratedForm()
    })

    expect(result.current.showGeneratedForm).toBe(false)
  })

  it('should use the advanced-chat endpoint and skip remote fetches when app detail is missing', async () => {
    appDetail = {
      id: 'app-2',
      mode: AppModeEnum.ADVANCED_CHAT,
    }

    const { result, rerender } = renderHook(() => useSingleRunFormParams({
      id: 'node-9',
      payload: currentInputs,
      runInputData: {},
      getInputVars,
      setRunInputData: mockSetRunInputData,
    }))

    await act(async () => {
      await result.current.handleFetchFormContent({ topic: 'hello' })
    })

    expect(mockFetchHumanInputNodeStepRunForm).toHaveBeenCalledWith(
      '/apps/app-2/advanced-chat/workflows/draft/human-input/nodes/node-9/form',
      {
        inputs: { topic: 'hello' },
      },
    )

    appDetail = undefined
    rerender()

    await act(async () => {
      const data = await result.current.handleFetchFormContent({ topic: 'skip' })
      expect(data).toBeNull()
    })

    expect(mockFetchHumanInputNodeStepRunForm).toHaveBeenCalledTimes(1)
  })
})
