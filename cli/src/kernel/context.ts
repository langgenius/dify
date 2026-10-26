import type { AnyPlugin, Deferred, ServiceOf } from './plugin'
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'

export type Override = readonly [AnyPlugin, unknown]

export class Context {
  private readonly cache = new Map<AnyPlugin, unknown>()
  private readonly pending = new Set<AnyPlugin>()
  private readonly defers: Deferred[] = []

  constructor(overrides: Iterable<Override> = []) {
    for (const [plugin, service] of overrides) this.cache.set(plugin, service)
  }

  async get<P extends AnyPlugin>(plugin: P): Promise<ServiceOf<P>> {
    if (this.cache.has(plugin)) return this.cache.get(plugin) as ServiceOf<P>
    if (this.pending.has(plugin))
      throw new BaseError({
        code: ErrorCode.Unknown,
        message: `kernel: cycle while building ${plugin.name}`,
      })
    this.pending.add(plugin)
    try {
      const service = await (plugin.build as (ctx: Context) => unknown)(this)
      this.cache.set(plugin, service)
      return service as ServiceOf<P>
    } finally {
      this.pending.delete(plugin)
    }
  }

  defer(fn: Deferred): void {
    this.defers.push(fn)
  }

  get deferred(): readonly Deferred[] {
    return this.defers
  }
}
