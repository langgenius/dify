import type { CommandContext } from '@/plugins/base'
import { join } from 'node:path'
import { z } from 'zod'
import { env } from '@/plugins/env'
import { io } from '@/plugins/io'
import { localFile, REMOVE } from '@/store/local-file'

export const PENDING_FILE_NAME = 'login-pending.yml'

const PENDING_SCHEMA = z.object({
  server: z.string(),
  insecure: z.boolean(),
  no_keyring: z.boolean(),
  device_code: z.string(),
})
export type Pending = z.infer<typeof PENDING_SCHEMA>

export type PendingLoginStore = Readonly<{
  read: () => Promise<Pending | null>
  save: (pending: Pending) => Promise<void>
  clear: () => Promise<void>
  /** Clear only while the file still holds `deviceCode`: a newer login's code survives. */
  clearIf: (deviceCode: string) => Promise<void>
}>

/** The device code a `login --no-wait` saved for `login --resume` to finish. */
export async function pendingLoginStore(ctx: CommandContext): Promise<PendingLoginStore> {
  const { configDir } = await ctx.get(env)
  const file = localFile(
    join(configDir, PENDING_FILE_NAME),
    PENDING_SCHEMA,
    (await ctx.get(io)).notice,
  )
  return {
    read: file.read,
    save: (pending) => file.update(() => pending),
    clear: () => file.update(() => REMOVE),
    clearIf: (deviceCode) =>
      file.update((pending) => (pending?.device_code === deviceCode ? REMOVE : undefined)),
  }
}
