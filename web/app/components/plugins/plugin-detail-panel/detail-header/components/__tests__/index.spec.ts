import { describe, expect, it } from 'vitest'
import { HeaderModals, PluginSourceBadge } from '../index'

describe('detail-header components index', () => {
  it('re-exports header modal components', () => {
    expect(HeaderModals).toBeDefined()
    expect(PluginSourceBadge).toBeDefined()
  })
})
