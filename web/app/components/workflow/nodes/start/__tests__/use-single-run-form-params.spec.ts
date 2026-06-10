import type { StartNodeType } from '../types'
import { renderHook } from '@testing-library/react'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import useSingleRunFormParams from '../use-single-run-form-params'

const mockUseTranslation = vi.hoisted(() => vi.fn())
const mockUseIsChatMode = vi.hoisted(() => vi.fn())

vi.mock('react-i18next', () => ({
  useTranslation: () => mockUseTranslation(),
}))

vi.mock('@/app/components/workflow/hooks', () => ({
  useIsChatMode: () => mockUseIsChatMode(),
}))

const createPayload = (overrides: Partial<StartNodeType> = {}): StartNodeType => ({
  title: 'Start',
  desc: '',
  type: BlockEnum.Start,
  variables: [{
    label: 'Question',
    variable: 'query',
    type: InputVarType.textInput,
    required: true,
  }],
  ...overrides,
})

describe('start/use-single-run-form-params', () => {
  const setRunInputData = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTranslation.mockReturnValue({
      t: (key: string) => key,
    })
  })

  it('should include sys.query and sys.files dependencies for chat mode', () => {
    mockUseIsChatMode.mockReturnValue(true)

    const { result } = renderHook(() => useSingleRunFormParams({
      id: 'start-node',
      payload: createPayload(),
      runInputData: { query: 'hello' },
      runInputDataRef: { current: {} },
      getInputVars: () => [],
      setRunInputData,
      toVarInputs: () => [],
    }))

    expect(result.current.forms).toHaveLength(1)
    expect(result.current.forms[0]!.label).toBe('nodes.llm.singleRun.variable')
    expect(result.current.forms[0]!.inputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ variable: 'query' }),
      expect.objectContaining({ variable: '#sys.query#', required: true }),
      expect.objectContaining({ variable: '#sys.files#', required: false }),
    ]))

    result.current.forms[0]!.onChange({ query: 'updated' })

    expect(setRunInputData).toHaveBeenCalledWith({ query: 'updated' })
    expect(result.current.getDependentVars()).toEqual([
      ['start-node', 'query'],
      ['sys', 'files'],
      ['sys', 'query'],
    ])
    expect(result.current.getDependentVar('query')).toEqual(['start-node', 'query'])
  })

  it('should omit sys.query when the workflow is not in chat mode', () => {
    mockUseIsChatMode.mockReturnValue(false)

    const { result } = renderHook(() => useSingleRunFormParams({
      id: 'start-node',
      payload: createPayload(),
      runInputData: {},
      runInputDataRef: { current: {} },
      getInputVars: () => [],
      setRunInputData,
      toVarInputs: () => [],
    }))

    expect(result.current.forms[0]!.inputs).toEqual(expect.not.arrayContaining([
      expect.objectContaining({ variable: '#sys.query#' }),
    ]))
    expect(result.current.getDependentVars()).toEqual([
      ['start-node', 'query'],
      ['sys', 'files'],
    ])
  })
})
