import { renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { useDSL } from '../use-DSL'

describe('useDSL', () => {
  it('returns the DSL handlers from hooks store', () => {
    const exportCheck = vi.fn()
    const handleExportDSL = vi.fn()

    const { result } = renderWorkflowHook(() => useDSL(), {
      hooksStoreProps: {
        exportCheck,
        handleExportDSL,
      },
    })

    expect(result.current.exportCheck).toBe(exportCheck)
    expect(result.current.handleExportDSL).toBe(handleExportDSL)
  })
})
