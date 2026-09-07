import type { AppReader } from './app-reader'
import type { AppInfoCache } from '@/cache/app-info'
import type { AppMeta, AppMetaFieldKey } from '@/types/app-meta'
import { covers, fromDescribe, mergeMeta } from '@/types/app-meta'

export type AppMetaClientOptions = {
  readonly apps: AppReader
  readonly host: string
  readonly cache?: AppInfoCache
  readonly now?: () => Date
}

export class AppMetaClient {
  private readonly apps: AppReader
  private readonly host: string
  private readonly cache: AppInfoCache | undefined
  private readonly now: () => Date

  constructor(opts: AppMetaClientOptions) {
    this.apps = opts.apps
    this.host = opts.host
    this.cache = opts.cache
    this.now = opts.now ?? (() => new Date())
  }

  async get(appId: string, fields: readonly AppMetaFieldKey[] = []): Promise<AppMeta> {
    const cached = this.cache?.get(this.host, appId)
    if (
      cached !== undefined &&
      this.cache?.isFresh(cached, this.now()) === true &&
      covers(cached.meta, fields)
    )
      return cached.meta

    const resp = await this.apps.describe(appId, fields.length === 0 ? undefined : fields)
    const fresh = fromDescribe(resp, fields)
    const merged =
      cached !== undefined && this.cache?.isFresh(cached, this.now()) === true
        ? mergeMeta(cached.meta, fresh)
        : fresh
    if (this.cache !== undefined) await this.cache.set(this.host, appId, merged)
    return merged
  }

  async invalidate(appId: string): Promise<void> {
    if (this.cache !== undefined) await this.cache.delete(this.host, appId)
  }
}
