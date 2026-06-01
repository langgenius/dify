import type { Store } from '@/store/store'
import { z } from 'zod'
import { getHostStore, tokenKey } from '@/store/manager'

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

export function loadHosts(): HostsBundle | undefined {
  const raw = getHostStore().getTyped<Record<string, unknown>>()
  if (raw === null)
    return undefined
  return HostsBundleSchema.parse(raw)
}

export function saveHosts(bundle: HostsBundle): void {
  const validated = HostsBundleSchema.parse(bundle)
  getHostStore().setTyped(validated)
}

export function clearLocal(bundle: HostsBundle, store: Store): void {
  const accountId = bundle.account?.id ?? bundle.external_subject?.email ?? 'default'
  try {
    store.unset(tokenKey(bundle.current_host, accountId))
  }
  catch { /* best-effort */ }
  getHostStore().rm()
}
