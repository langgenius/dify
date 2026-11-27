import { act as reactAct } from 'react'

type ActEnvironment = typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

/**
 * Browser Mode `act` for flushing updates caused by settling a controlled promise.
 *
 * React only accepts `act` while `IS_REACT_ACT_ENVIRONMENT` is true. `vitest-browser-react`
 * sets it during `render` and resets it afterward, so calling `act` from `react` directly logs
 * "The current testing environment is not configured to support act(...)" whenever any update
 * lands in its scope, which spans macrotasks. This mirrors the library's internal `act`.
 */
export async function act(callback: () => void | Promise<void>) {
  const environment = globalThis as ActEnvironment
  const previous = environment.IS_REACT_ACT_ENVIRONMENT
  environment.IS_REACT_ACT_ENVIRONMENT = true
  try {
    await reactAct(async () => {
      await callback()
    })
  } finally {
    environment.IS_REACT_ACT_ENVIRONMENT = previous
  }
}
