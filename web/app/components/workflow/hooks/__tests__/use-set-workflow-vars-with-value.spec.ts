import { renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { useSetWorkflowVarsWithValue } from '../use-set-workflow-vars-with-value'

describe('useSetWorkflowVarsWithValue', () => {
  it('returns fetchInspectVars from hooks store', () => {
    const fetchInspectVars = vi.fn()

    const { result } = renderWorkflowHook(() => useSetWorkflowVarsWithValue(), {
      hooksStoreProps: { fetchInspectVars },
    })

    expect(result.current.fetchInspectVars).toBe(fetchInspectVars)
  })
})
