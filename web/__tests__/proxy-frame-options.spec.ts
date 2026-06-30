import { describe, expect, it } from 'vitest'
import { canEmbedPath } from '@/proxy'

describe('proxy frame options', () => {
  it('should allow embedded share routes', () => {
    expect(canEmbedPath('/chatbot/token')).toBe(true)
    expect(canEmbedPath('/workflow/token')).toBe(true)
    expect(canEmbedPath('/completion/token')).toBe(true)
    expect(canEmbedPath('/webapp-signin')).toBe(true)
    expect(canEmbedPath('/agent/token')).toBe(true)
  })

  it('should deny non-embedded console routes by default', () => {
    expect(canEmbedPath('/agents')).toBe(false)
    expect(canEmbedPath('/agent-settings')).toBe(false)
    expect(canEmbedPath('/agentic')).toBe(false)
    expect(canEmbedPath('/roster/agent/agent-1/access')).toBe(false)
    expect(canEmbedPath('/apps')).toBe(false)
  })
})
