import type { StorageMode } from '@/store/store'
import type { TokenStore } from '@/store/token-store'
import { z } from 'zod'
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { getHostStore } from '@/store/manager'
import { STORAGE_MODES } from '@/store/store'

const StorageModeSchema = z.enum(STORAGE_MODES)

export type { StorageMode } from '@/store/store'

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

export const AccountContextSchema = z.object({
  account: AccountSchema,
  workspace: WorkspaceSchema.optional(),
  token_id: z.string().optional(),
  token_expires_at: z.string().optional(),
  external_subject: ExternalSubjectSchema.optional(),
})
export type AccountContext = z.infer<typeof AccountContextSchema>

export const HostEntrySchema = z.object({
  scheme: z.string().optional(),
  insecure_tls: z.boolean().optional(),
  current_account: z.string().optional(),
  accounts: z.record(z.string(), AccountContextSchema).default({}),
})
export type HostEntry = z.infer<typeof HostEntrySchema>

export const RegistrySchema = z.object({
  token_storage: StorageModeSchema.default('file'),
  current_host: z.string().optional(),
  hosts: z.record(z.string(), HostEntrySchema).default({}),
})
export type RegistryData = z.infer<typeof RegistrySchema>

export type ActiveContext = {
  readonly host: string
  readonly email: string
  readonly ctx: AccountContext
  readonly scheme?: string
  readonly insecureTls?: boolean
}

export function notLoggedInError(hint = 'run \'difyctl auth login\''): BaseError {
  return new BaseError({ code: ErrorCode.NotLoggedIn, message: 'not logged in', hint })
}

export class Registry {
  private readonly data: RegistryData

  private constructor(data: RegistryData) {
    this.data = data
  }

  static async load(): Promise<Registry> {
    const raw = await getHostStore().getTyped<Record<string, unknown>>()
    if (raw === null)
      return Registry.empty()
    return new Registry(RegistrySchema.parse(raw))
  }

  static empty(mode: StorageMode = 'file'): Registry {
    return new Registry(RegistrySchema.parse({ token_storage: mode, hosts: {} }))
  }

  static from(data: RegistryData): Registry {
    return new Registry(data)
  }

  get hosts(): RegistryData['hosts'] { return this.data.hosts }
  get current_host(): string | undefined { return this.data.current_host }
  get token_storage(): StorageMode { return this.data.token_storage }
  set token_storage(mode: StorageMode) { this.data.token_storage = mode }

  resolveActive(): ActiveContext | undefined {
    const host = this.data.current_host
    if (host === undefined || host === '')
      return undefined
    const entry = this.data.hosts[host]
    if (entry === undefined)
      return undefined
    const email = entry?.current_account
    if (!email)
      return undefined
    const ctx = entry.accounts[email]
    if (ctx === undefined)
      return undefined
    return { host, email, ctx, scheme: entry.scheme, insecureTls: entry.insecure_tls }
  }

  requireActive(hint?: string): ActiveContext {
    const active = this.resolveActive()
    if (active === undefined)
      throw notLoggedInError(hint)
    return active
  }

  upsert(host: string, email: string, ctx: AccountContext): void {
    const entry = this.data.hosts[host] ?? { accounts: {} }
    entry.accounts[email] = ctx
    this.data.hosts[host] = entry
  }

  remove(host: string, email: string): void {
    const entry = this.data.hosts[host]
    if (entry === undefined)
      return
    const wasActive = entry.current_account === email
    delete entry.accounts[email]
    if (wasActive)
      entry.current_account = undefined
    if (Object.keys(entry.accounts).length === 0) {
      delete this.data.hosts[host]
      if (this.data.current_host === host)
        this.data.current_host = undefined
    }
    else if (wasActive && this.data.current_host === host) {
      this.data.current_host = undefined
    }
  }

  setHost(host: string): void {
    this.data.current_host = host
  }

  setAccount(email: string): void {
    const host = this.data.current_host
    if (host === undefined)
      return
    const entry = this.data.hosts[host]
    if (entry !== undefined)
      entry.current_account = email
  }

  setScheme(host: string, scheme: string): void {
    const entry = this.data.hosts[host]
    if (entry !== undefined)
      entry.scheme = scheme
  }

  setInsecureTls(host: string, insecure: boolean): void {
    const entry = this.data.hosts[host]
    if (entry !== undefined)
      entry.insecure_tls = insecure
  }

  activate(host: string, email: string, ctx: AccountContext): void {
    this.upsert(host, email, ctx)
    this.setHost(host)
    this.setAccount(email)
  }

  // Teardown for "this credential is gone": drop the token, drop the context
  // (unsets pointers when active), persist. Logout + self-revoke share it.
  async forget(active: ActiveContext, store: TokenStore): Promise<void> {
    try {
      await store.remove(active.host, active.email)
    }
    catch { /* best-effort */ }
    this.remove(active.host, active.email)
    await this.save()
  }

  async save(): Promise<void> {
    await getHostStore().setTyped(RegistrySchema.parse(this.data))
  }
}
