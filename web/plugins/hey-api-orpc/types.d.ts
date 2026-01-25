import type { DefinePlugin, IR, Plugin } from '@hey-api/openapi-ts'

export type UserConfig = Plugin.Name<'orpc'>
  & Plugin.Hooks & {
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
     * Default tag name for operations without tags.
     * @default 'default'
     */
    defaultTag?: string
    /**
     * Custom function to extract group key for router grouping.
     * Receives the full IR.OperationObject.
     * @default extracts first path segment as camelCase
     */
    groupKeyBuilder?: (operation: IR.OperationObject) => string
    /**
     * Custom function to generate operation key within a group.
     * @default (operationId, groupKey) => simplified operationId
     */
    operationKeyBuilder?: (operationId: string, groupKey: string) => string
  }

export type Config = Plugin.Name<'orpc'>
  & Plugin.Hooks & {
    output: string
    exportFromIndex: boolean
    contractNameBuilder: (operationId: string) => string
    defaultTag: string
    groupKeyBuilder: (operation: IR.OperationObject) => string
    operationKeyBuilder: (operationId: string, groupKey: string) => string
  }

export type OrpcPlugin = DefinePlugin<UserConfig, Config>
