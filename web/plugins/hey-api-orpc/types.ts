import type { DefinePlugin } from '@hey-api/openapi-ts'

export type Config = { name: 'orpc' } & {
  /**
   * Name of the generated file.
   * @default 'orpc'
   */
  output?: string

  /**
   * The name of the base contract variable.
   * @default 'base'
   */
  baseName?: string

  /**
   * Whether to generate a contracts object that combines all contracts.
   * @default true
   */
  generateRouter?: boolean

  /**
   * Whether to export from index file.
   * @default false
   */
  exportFromIndex?: boolean
}

export type ResolvedConfig = Config & {
  output: string
  baseName: string
  generateRouter: boolean
  exportFromIndex: boolean
}

export type OrpcPlugin = DefinePlugin<Config, ResolvedConfig>
