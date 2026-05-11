import { describe, expect, it } from 'vitest'
import { usePluginInstalledCheck, useToolSelectorState } from '../index'

describe('tool-selector hooks index', () => {
  it('re-exports the tool selector hooks', () => {
    expect(usePluginInstalledCheck).toBeTypeOf('function')
    expect(useToolSelectorState).toBeTypeOf('function')
  })
})
