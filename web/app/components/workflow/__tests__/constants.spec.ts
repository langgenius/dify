import { getGlobalVars } from '../constants'
import { VarType } from '../types'

describe('getGlobalVars', () => {
  beforeEach(() => {
    globalThis.history.replaceState({}, '', '/app/app-id/workflow')
  })

  it('should expose bulk execution status for workflows', () => {
    expect(getGlobalVars(false)).toContainEqual({
      variable: 'sys.is_bulk_execution',
      type: VarType.boolean,
    })
  })

  it('should not expose bulk execution status for chatflows', () => {
    expect(getGlobalVars(true)).not.toContainEqual({
      variable: 'sys.is_bulk_execution',
      type: VarType.boolean,
    })
  })
})
