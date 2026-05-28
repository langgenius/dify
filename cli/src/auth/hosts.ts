import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { z } from 'zod'
import { DIR_PERM, FILE_PERM } from '../config/dir.js'

export const HOSTS_FILE_NAME = 'hosts.yml'

const StorageModeSchema = z.enum(['keychain', 'file'])
export type StorageMode = z.infer<typeof StorageModeSchema>

export const AccountSchema = z.object({
  id: z.string().optional(),
  email: z.string().default(''),
  name: z.string().default(''),
})
export type Account = z.infer<typeof AccountSchema>

export const WorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
})
export type Workspace = z.infer<typeof WorkspaceSchema>

export const ExternalSubjectSchema = z.object({
  email: z.string(),
  issuer: z.string(),
})
export type ExternalSubject = z.infer<typeof ExternalSubjectSchema>

export const TokensSchema = z.object({
  bearer: z.string(),
})
export type Tokens = z.infer<typeof TokensSchema>

export const HostsBundleSchema = z.object({
  current_host: z.string().default(''),
  scheme: z.string().optional(),
  account: AccountSchema.optional(),
  workspace: WorkspaceSchema.optional(),
  available_workspaces: z.array(WorkspaceSchema).optional(),
  token_storage: StorageModeSchema.default('file'),
  token_id: z.string().optional(),
  token_expires_at: z.string().optional(),
  tokens: TokensSchema.optional(),
  external_subject: ExternalSubjectSchema.optional(),
})
export type HostsBundle = z.infer<typeof HostsBundleSchema>

export async function loadHosts(dir: string): Promise<HostsBundle | undefined> {
  const path = join(dir, HOSTS_FILE_NAME)
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT')
      return undefined
    throw err
  }
  const parsed = yaml.load(raw)
  return HostsBundleSchema.parse(parsed ?? {})
}

export async function saveHosts(dir: string, bundle: HostsBundle): Promise<void> {
  await mkdir(dir, { recursive: true, mode: DIR_PERM })
  const validated = HostsBundleSchema.parse(bundle)
  const body = yaml.dump(stripUndefined(validated), { lineWidth: -1, noRefs: true, sortKeys: false })
  const target = join(dir, HOSTS_FILE_NAME)
  const tmp = `${target}.tmp.${process.pid}.${Date.now()}`
  try {
    await writeFile(tmp, body, { mode: FILE_PERM })
    await rename(tmp, target)
  }
  catch (err) {
    try {
      await unlink(tmp)
    }
    catch { /* tmp may not exist */ }
    throw err
  }
  const { chmod, stat } = await import('node:fs/promises')
  try {
    const info = await stat(target)
    if ((info.mode & 0o777) !== FILE_PERM)
      await chmod(target, FILE_PERM)
  }
  catch { /* best-effort */ }
}

function stripUndefined<T extends Record<string, unknown>>(input: T): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined)
      continue
    out[k] = v
  }
  return out
}
