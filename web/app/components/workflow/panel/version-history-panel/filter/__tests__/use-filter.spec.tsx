import { renderHook } from '@testing-library/react'
import { WorkflowVersionFilterOptions } from '../../../../types'
import { useFilterOptions } from '../use-filter'

describe('useFilterOptions', () => {
  it('returns the translated version filter options', () => {
    const { result } = renderHook(() => useFilterOptions())

    expect(result.current).toEqual([
      {
        key: WorkflowVersionFilterOptions.all,
        name: 'workflow.versionHistory.filter.all',
      },
      {
        key: WorkflowVersionFilterOptions.onlyYours,
        name: 'workflow.versionHistory.filter.onlyYours',
      },
    ])
  })
})
