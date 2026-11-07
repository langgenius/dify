import type { CodeNodeType, OutputVar } from '../types'
import type { Variable } from '@/app/components/workflow/types'
import { act, waitFor } from '@testing-library/react'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { fetchNodeDefault, fetchPipelineNodeDefault } from '@/service/workflow'
import { renderNodeConfig } from '../../__tests__/render-node-config'
import { CodeLanguage } from '../types'
import useConfig from '../use-config'

vi.mock('@/service/workflow', () => ({
  fetchNodeDefault: vi.fn(),
  fetchPipelineNodeDefault: vi.fn(),
}))
const createVariable = (variable: string, valueType: VarType = VarType.string): Variable => ({
  variable,
  value_selector: ['start', variable],
  value_type: valueType,
})

const createOutputs = (name = 'result', type: VarType = VarType.string): OutputVar => ({
  [name]: {
    type,
    children: null,
  },
})

const createData = (overrides: Partial<CodeNodeType> = {}): CodeNodeType => ({
  title: 'Code',
  desc: '',
  type: BlockEnum.Code,
  code_language: CodeLanguage.javascript,
  code: 'function main({ foo }) { return { result: foo } }',
  variables: [createVariable('foo')],
  outputs: createOutputs(),
  ...overrides,
})

describe('code/use-config', () => {
  const python = createData({
    code_language: CodeLanguage.python3,
    code: 'def main(name: str):\n    return {"result": name}',
    variables: [createVariable('name')],
  })
  beforeEach(() => {
    for (const fetchDefaults of [fetchNodeDefault, fetchPipelineNodeDefault]) {
      vi.mocked(fetchDefaults).mockReset()
      vi.mocked(fetchDefaults)
        .mockResolvedValueOnce({ config: createData() })
        .mockResolvedValueOnce({ config: python })
    }
  })
  it('offers integer variables, such as integer tool outputs, as code inputs while rejecting unsupported types', () => {
    const { result } = renderNodeConfig(useConfig, createData(), {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })
    expect(result.current.config.filterVar({ variable: 'code', type: VarType.integer })).toBe(true)
    expect(result.current.config.filterVar({ variable: 'code', type: VarType.any })).toBe(false)
  })
  it('hydrates empty code and output ordering from stored defaults', async () => {
    const defaults = createData({ outputs: createOutputs('default_result') })
    const { result } = renderNodeConfig(
      useConfig,
      createData({ code: '', variables: [], outputs: {} }),
      {
        resource: { kind: 'snippet', snippetId: 's' },
        initialStoreState: { nodesDefaultConfigs: { [BlockEnum.Code]: defaults } },
      },
    )
    await waitFor(() => expect(result.current.flow.getNode('node')?.data).toMatchObject(defaults))
    expect(result.current.config.outputKeyOrders).toEqual(['default_result'])
  })
  it.each(['app', 'knowledge-pipeline'] as const)(
    'loads %s defaults and preserves language across subsequent edits',
    async (kind) => {
      const { result } = renderNodeConfig(useConfig, createData(), {
        resource:
          kind === 'app'
            ? { kind, appId: 'app-1', mode: 'workflow' }
            : { kind, pipelineId: 'pipeline-1' },
      })
      const fetchDefaults = kind === 'app' ? fetchNodeDefault : fetchPipelineNodeDefault
      const other = kind === 'app' ? fetchPipelineNodeDefault : fetchNodeDefault
      await waitFor(() =>
        expect(fetchDefaults).toHaveBeenCalledWith(
          kind === 'app' ? 'app-1' : 'pipeline-1',
          BlockEnum.Code,
          { code_language: CodeLanguage.python3 },
        ),
      )
      act(() => result.current.config.handleCodeLanguageChange(CodeLanguage.python3))
      expect(result.current.flow.getNode('node')?.data).toMatchObject(python)
      act(() => result.current.config.handleCodeChange('def main(): pass'))
      act(() =>
        result.current.config.handleCodeAndVarsChange(
          'def main(amount: float): return {"total": amount}',
          [createVariable('amount', VarType.number)],
          createOutputs('total', VarType.number),
        ),
      )
      expect(result.current.flow.getNode('node')?.data).toMatchObject({
        code_language: CodeLanguage.python3,
        code: 'def main(amount: float): return {"total": amount}',
        variables: [createVariable('amount', VarType.number)],
        outputs: createOutputs('total', VarType.number),
      })
      expect(result.current.config.outputKeyOrders).toEqual(['total'])
      expect(other).not.toHaveBeenCalled()
    },
  )
  it.each([
    {
      language: CodeLanguage.javascript,
      code: 'function main() { return {} }',
      variables: [createVariable('foo'), createVariable('bar')],
      expected: 'function main({foo, bar}) { return {} }',
    },
    {
      language: CodeLanguage.python3,
      code: 'def main(): return {}',
      variables: [
        createVariable('text'),
        createVariable('score', VarType.number),
        createVariable('payload', VarType.object),
        createVariable('items', VarType.array),
        createVariable('numbers', VarType.arrayNumber),
        createVariable('names', VarType.arrayString),
        createVariable('records', VarType.arrayObject),
      ],
      expected:
        'def main(text: str, score: float, payload: dict, items: list, numbers: list[float], names: list[str], records: list[dict]): return {}',
    },
    {
      language: CodeLanguage.json,
      code: '{"result": true}',
      variables: [],
      expected: '{"result": true}',
    },
  ])(
    'synchronizes the $language signature using persisted bindings',
    ({ language, code, variables, expected }) => {
      const { result } = renderNodeConfig(
        useConfig,
        createData({ code_language: language, code, variables }),
        { resource: { kind: 'snippet', snippetId: 's' } },
      )
      act(() => result.current.config.handleSyncFunctionSignature())
      expect(result.current.flow.getNode('node')?.data.code).toBe(expected)
    },
  )
  it('preserves code and outputs when a snippet has no server language defaults', () => {
    const inputs = createData({
      outputs: { ...createOutputs('summary'), ...createOutputs('count', VarType.number) },
    })
    const { result } = renderNodeConfig(useConfig, inputs, {
      resource: { kind: 'snippet', snippetId: 's' },
    })
    act(() => result.current.config.handleCodeLanguageChange(CodeLanguage.python3))
    expect(result.current.flow.getNode('node')?.data).toMatchObject({
      ...inputs,
      code_language: CodeLanguage.python3,
    })
    expect(result.current.config.outputKeyOrders).toEqual(['summary', 'count'])
    expect(fetchNodeDefault).not.toHaveBeenCalled()
    expect(fetchPipelineNodeDefault).not.toHaveBeenCalled()
  })
})
