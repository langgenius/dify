import type { CommandContext } from '@/plugins/base'
import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { env } from '@/plugins/env'
import { io } from '@/plugins/io'
import { localFile } from '@/store/local-file'

export const INSTALLATION_FILE_NAME = 'installation.yml'
export const INSTALLATION_ID_PATTERN = /^[a-z0-9-]{8,64}$/i
// The server indexes only the first 191 characters of a device label; the id part must fit inside them.
const DEVICE_LABEL_HOSTNAME_MAX = 64
const DEVICE_LABEL_ID_LENGTH = 8

const INSTALLATION_SCHEMA = z.object({ id: z.string().regex(INSTALLATION_ID_PATTERN) })

/** This config dir's stable id. A missing or unusable file gets a fresh id, under the file lock. */
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

/** The label a device login sends, for example `myhost (a1b2c3d4)`. The server replaces the older
 * session with the same label, so a relogin replaces this install's session and no other. */
export async function deviceLabel(ctx: CommandContext): Promise<string> {
  const id = await installationId(ctx)
  return `${hostname().slice(0, DEVICE_LABEL_HOSTNAME_MAX)} (${id.slice(0, DEVICE_LABEL_ID_LENGTH)})`
}
