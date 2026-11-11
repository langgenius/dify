import type { StartNodeType } from '../types'
import { renderEditorHook as renderHook } from '@/app/components/workflow/editor-resource/__tests__/render'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import useSingleRunFormParams from '../use-single-run-form-params'

const createPayload = (overrides: Partial<StartNodeType> = {}): StartNodeType => ({
  title: 'Start',
  desc: '',
  type: BlockEnum.Start,
  variables: [
    {
      label: 'Question',
      variable: 'query',
      type: InputVarType.textInput,
      required: true,
    },
  ],
  ...overrides,
})

describe('start/use-single-run-form-params', () => {
  const setRunInputData = vi.fn()

  it('should include sys.query and sys.files dependencies for chat mode', () => {
    const { result } = renderHook(
      () =>
        useSingleRunFormParams({
          id: 'start-node',
          payload: createPayload(),
          runInputData: { query: 'hello' },
          runInputDataRef: { current: {} },
          getInputVars: () => [],
          setRunInputData,
          toVarInputs: () => [],
        }),
      {
        resource: {
          kind: 'app',
          appId: 'app-1',
          mode: 'advanced-chat',
        },
      },
    )

    expect(result.current.forms).toHaveLength(1)
    expect(result.current.forms[0]!.inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ variable: 'query' }),
        expect.objectContaining({ variable: '#sys.query#', required: true }),
        expect.objectContaining({ variable: '#sys.files#', required: false }),
      ]),
    )

    expect(result.current.getDependentVars()).toEqual([
      ['start-node', 'query'],
      ['sys', 'files'],
      ['sys', 'query'],
    ])
    expect(result.current.getDependentVar('query')).toEqual(['start-node', 'query'])
  })

  it('should omit sys.query when the workflow is not in chat mode', () => {
    const { result } = renderHook(
      () =>
        useSingleRunFormParams({
          id: 'start-node',
          payload: createPayload(),
          runInputData: {},
          runInputDataRef: { current: {} },
          getInputVars: () => [],
          setRunInputData,
          toVarInputs: () => [],
        }),
      {
        resource: {
          kind: 'app',
          appId: 'app-1',
          mode: 'workflow',
        },
      },
    )

    expect(result.current.forms[0]!.inputs).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ variable: '#sys.query#' })]),
    )
    expect(result.current.getDependentVars()).toEqual([
      ['start-node', 'query'],
      ['sys', 'files'],
    ])
  })
})
