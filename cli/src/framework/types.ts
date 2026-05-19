import type { CommandOutput } from './output.js'

export type ArgValueType = string | boolean | number | string[]
export type OptionalArgValueType = ArgValueType | undefined

export type FlagDefinition<T extends OptionalArgValueType = OptionalArgValueType> = {
  readonly type: 'string' | 'boolean' | 'integer'
  readonly description: string
  readonly char?: string
  readonly default?: ArgValueType
  readonly multiple?: boolean
  readonly helpGroup?: string
  readonly options?: readonly string[]
  readonly _flagValue?: T
}

export type ArgDefinition<T extends string | undefined = string | undefined> = {
  readonly description: string
  readonly required?: boolean
  readonly _argValue?: T
}

export type InferArgs<TArgs extends Record<string, ArgDefinition<string | undefined>>> = {
  readonly [K in keyof TArgs]: TArgs[K] extends ArgDefinition<infer V> ? V : never
}

export type InferFlags<TFlags extends Record<string, FlagDefinition<OptionalArgValueType>>> = {
  readonly [K in keyof TFlags]: TFlags[K] extends FlagDefinition<infer V> ? V : never
}

export type ParsedFlags = Record<string, OptionalArgValueType>

export type ParsedArgs = Record<string, string | undefined>

export type CommandMeta = {
  readonly flags: Record<string, FlagDefinition>
  readonly args: Record<string, ArgDefinition>
}

export type ICommand = {
  readonly run: (argv: string[]) => Promise<CommandOutput | void>
}
