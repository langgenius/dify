import type { CommandContext } from '@/plugins/base'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import { env } from '@/plugins/env'
import { io } from '@/plugins/io'
import { localFile } from '@/store/local-file'

export const INSTALLATION_FILE_NAME = 'installation.yml'
export const INSTALLATION_ID_PATTERN = /^[a-z0-9-]{8,64}$/i

const INSTALLATION_SCHEMA = z.object({ id: z.string().regex(INSTALLATION_ID_PATTERN) })

/** This config dir's stable id. Device logins send it, so the server replaces this install's
 * older session and no other. A missing or unusable file gets a fresh id, under the file lock. */
export async function installationId(ctx: CommandContext): Promise<string> {
  const { configDir } = await ctx.get(env)
  const file = localFile(
    join(configDir, INSTALLATION_FILE_NAME),
    INSTALLATION_SCHEMA,
    (await ctx.get(io)).notice,
  )
  let id: string = randomUUID()
  await file.update((doc) => {
    if (doc === null) return { id }
    id = doc.id
    return undefined
  })
  return id
}
