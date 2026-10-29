import type { CommandContext } from '@/plugins/base'
import type { LockTiming } from '@/store/store'
import { join } from 'node:path'
import { env } from '@/plugins/env'
import { withFileLock } from '@/store/store'

// Separate from login.yml's own lock, which a save takes while this one is held.
export const LOGIN_FLOW_LOCK = 'login-flow'
// One poll plus revoking the previous login fits well inside; a crashed login frees it.
const LOGIN_FLOW_LOCK_TIMING: LockTiming = { staleMs: 120_000, waitMs: 120_000 }

/** Held by every login in this config dir from a poll that may mint a token until that token is saved. */
export async function withLoginFlowLock<R>(
  ctx: CommandContext,
  body: () => Promise<R>,
): Promise<R> {
  const { configDir } = await ctx.get(env)
  return withFileLock(join(configDir, LOGIN_FLOW_LOCK), body, LOGIN_FLOW_LOCK_TIMING)
}
