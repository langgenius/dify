import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CONVERSATION_ACTIVITY_INFO, CONVERSATION_ID_INFO } from '../constants'

const HOUR = 60 * 60 * 1000

const loadStorage = async (resetHours: number) => {
  vi.resetModules()
  vi.doMock('@/env', () => ({ env: { NEXT_PUBLIC_CHAT_SESSION_RESET_HOURS: resetHours } }))
  return import('../storage')
}

describe('useConversationSelection session reset', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  const seed = (lastMessageAgoMs: number) => {
    localStorage.setItem(CONVERSATION_ID_INFO, JSON.stringify({ app1: { user1: 'conv-1' } }))
    localStorage.setItem(
      CONVERSATION_ACTIVITY_INFO,
      JSON.stringify({ app1: { user1: Date.now() - lastMessageAgoMs } }),
    )
  }

  it('starts a new chat when the last message is older than the window', async () => {
    seed(25 * HOUR)
    const { useConversationSelection } = await loadStorage(24)
    const { result } = renderHook(() =>
      useConversationSelection({ scopeId: 'app1', userId: 'user1' }),
    )
    expect(result.current.currentConversationId).toBe('')
  })

  it('keeps the conversation when the last message is within the window', async () => {
    seed(23 * HOUR)
    const { useConversationSelection } = await loadStorage(24)
    const { result } = renderHook(() =>
      useConversationSelection({ scopeId: 'app1', userId: 'user1' }),
    )
    expect(result.current.currentConversationId).toBe('conv-1')
  })

  it('never resets when the feature is disabled (0 hours)', async () => {
    seed(1000 * HOUR)
    const { useConversationSelection } = await loadStorage(0)
    const { result } = renderHook(() =>
      useConversationSelection({ scopeId: 'app1', userId: 'user1' }),
    )
    expect(result.current.currentConversationId).toBe('conv-1')
  })

  it('does not reset an explicitly provided conversation id', async () => {
    seed(25 * HOUR)
    const { useConversationSelection } = await loadStorage(24)
    const { result } = renderHook(() =>
      useConversationSelection({ scopeId: 'app1', userId: 'user1', conversationId: 'fixed' }),
    )
    expect(result.current.currentConversationId).toBe('fixed')
  })

  it('records activity so the window counts from the last message', async () => {
    const { useConversationSelection } = await loadStorage(24)
    const { result } = renderHook(() =>
      useConversationSelection({ scopeId: 'app1', userId: 'user1' }),
    )
    act(() => result.current.touchConversationActivity())
    const stored = JSON.parse(localStorage.getItem(CONVERSATION_ACTIVITY_INFO) ?? '{}')
    expect(Date.now() - stored.app1.user1).toBeLessThan(5000)
  })
})
