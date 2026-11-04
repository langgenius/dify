export type Deferred = () => void | Promise<void>

export type Plugin<Name extends string, T, N extends readonly AnyPlugin[]> = {
  readonly name: Name
  readonly needs: N
  readonly build: (ctx: BuildContext<N[number]>) => T | Promise<T>
}

export type AnyPlugin = {
  readonly name: string
  readonly needs: readonly AnyPlugin[]
  readonly build: (ctx: never) => unknown
}
export type ServiceOf<P extends AnyPlugin> = Awaited<ReturnType<P['build']>>

export type BuildContext<Allowed extends AnyPlugin> = {
  readonly get: <P extends Allowed>(plugin: P) => Promise<ServiceOf<P>>
  readonly defer: (fn: Deferred) => void
}

export function definePlugin<const Name extends string, T, const N extends readonly AnyPlugin[]>(
  spec: Plugin<Name, T, N>,
): Plugin<Name, T, N> {
  return spec
}
