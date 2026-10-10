import type { CommandContext } from '@/plugins/base'
import { join } from 'node:path'
import { z } from 'zod'
import { env } from '@/plugins/env'
import { YamlStore } from '@/store/store'

export const PENDING_FILE_NAME = 'login-pending.yml'

const PENDING_SCHEMA = z.object({
  server: z.string(),
  insecure: z.boolean(),
  no_keyring: z.boolean(),
  device_code: z.string(),
})
export type Pending = z.infer<typeof PENDING_SCHEMA>

export type PendingLoginStore = Readonly<{
  read: () => Promise<Pending | undefined>
  save: (pending: Pending) => Promise<void>
  clear: () => Promise<void>
}>

/** The device code a `login --no-wait` saved for `login --resume` to finish. */
export async function pendingLoginStore(ctx: CommandContext): Promise<PendingLoginStore> {
  const { configDir } = await ctx.get(env)
  const file = new YamlStore(join(configDir, PENDING_FILE_NAME))
  return {
    read: async () => PENDING_SCHEMA.safeParse(await file.getTyped<unknown>()).data,
    save: (pending) => file.setTyped(pending),
    clear: () => file.rm(),
  }
}
