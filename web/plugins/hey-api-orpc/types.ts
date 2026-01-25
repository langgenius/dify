import type { DefinePlugin } from '@hey-api/openapi-ts'

export type FileStrategy = 'single' | 'byTags'

export type Config = { name: 'orpc' } & {
  /**
   * Name of the generated file (when fileStrategy is 'single').
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
  /**
   * File generation strategy.
   * - 'single': All contracts in one file (default)
   * - 'byTags': One file per tag (e.g., orpc/chat.ts, orpc/files.ts)
   * @default 'single'
   */
  fileStrategy?: FileStrategy
  /**
   * Custom file path builder when fileStrategy is 'byTags'.
   * @default (tag) => `orpc/${tag}`
   */
  filePathBuilder?: (tag: string) => string
  /**
   * Default tag name for operations without tags.
   * @default 'default'
   */
  defaultTag?: string
}

export type ResolvedConfig = {
  name: 'orpc'
  output: string
  exportFromIndex: boolean
  contractNameBuilder: (operationId: string) => string
  groupBy: 'tag' | 'none'
  fileStrategy: FileStrategy
  filePathBuilder: (tag: string) => string
  defaultTag: string
}

export type OrpcPlugin = DefinePlugin<Config, ResolvedConfig>
