import { act, configure, getConfig } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

type User = ReturnType<typeof userEvent.setup>

export async function runDebouncedUserInteraction(
  debounceMs: number,
  interaction: (user: User) => Promise<void>,
) {
  vi.useFakeTimers()
  const originalAsyncWrapper = getConfig().asyncWrapper

  // RTL's asyncWrapper drains a 0ms timer through Jest globals, which hangs with Vitest fake timers.
  configure({ asyncWrapper: (callback) => callback() })

  try {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await act(async () => interaction(user))
    await act(async () => vi.advanceTimersByTimeAsync(debounceMs + 1))
    await act(async () => vi.advanceTimersByTimeAsync(0))
  } finally {
    try {
      configure({ asyncWrapper: originalAsyncWrapper })
    } finally {
      vi.useRealTimers()
    }
  }
}
