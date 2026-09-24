import { describe, expect, it } from 'vite-plus/test'
import RunApp from './index'

describe('run app agentGuide', () => {
  it('exposes non-empty agentGuide string', () => {
    const guide = new RunApp().agentGuide()
    expect(typeof guide).toBe('string')
    expect(guide.length).toBeGreaterThan(0)
  })

  it('agentGuide mentions WORKFLOW section', () => {
    const guide = new RunApp().agentGuide()
    expect(guide).toContain('WORKFLOW')
  })

  it('agentGuide mentions ERROR RECOVERY section', () => {
    const guide = new RunApp().agentGuide()
    expect(guide).toContain('ERROR RECOVERY')
  })
})
