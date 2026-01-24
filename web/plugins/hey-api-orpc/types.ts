import type { DefinePlugin } from '@hey-api/openapi-ts'

export type Config = { name: 'orpc' } & {
  /**
   * Name of the generated file.
   * @default 'orpc'
   */
  output?: string
}

export type ResolvedConfig = Config & {
  output: string
}

export type OrpcPlugin = DefinePlugin<Config, ResolvedConfig>
