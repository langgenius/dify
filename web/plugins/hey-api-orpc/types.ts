import type { DefinePlugin } from '@hey-api/openapi-ts'

export type Config = { name: 'orpc' } & {
  /**
   * Name of the generated file.
   * @default 'orpc'
   */
  output?: string
  /**
   * Whether exports should be re-exported in the index file.
   * @default false
   */
  exportFromIndex?: boolean
  /**
   * Custom naming function for contract symbols.
   * @default (id) => `${id}Contract`
   */
  contractNameBuilder?: (operationId: string) => string
  /**
   * How to group contracts in the exported object.
   * - 'tag': Group by OpenAPI tags (default)
   * - 'none': Flat structure without grouping
   * @default 'tag'
   */
  groupBy?: 'tag' | 'none'
}

export type ResolvedConfig = {
  name: 'orpc'
  output: string
  exportFromIndex: boolean
  contractNameBuilder: (operationId: string) => string
  groupBy: 'tag' | 'none'
}

export type OrpcPlugin = DefinePlugin<Config, ResolvedConfig>
