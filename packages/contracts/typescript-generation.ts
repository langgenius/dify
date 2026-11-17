/** Shared by contract generation and the mapper's in-memory type exporter. */
export const typescriptPlugin = (enterprise = false) => ({
  name: '@hey-api/typescript' as const,
  comments: false,
  ...(enterprise ? { enums: { mode: 'javascript' as const } } : {}),
})

export const stripEnterpriseSchemaNamePrefix = (name: string) =>
  name
    .replace(/^dify\.enterprise\.api\.enterprise\./, '')
    .replace(/^dify\.enterprise\.api\.appdeploy\.v1\./, '')
    .replace(/^dify\.enterprise\.api\.appdeploy\./, '')
    .replace(/^pagination\./, '')
