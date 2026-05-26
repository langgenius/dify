import { z } from 'zod'

export const CURRENT_SCHEMA_VERSION = 1
export const FILE_NAME = 'config.yml'

export const ALLOWED_FORMATS = ['json', 'yaml', 'table', 'wide', 'name', 'text'] as const
export type AllowedFormat = (typeof ALLOWED_FORMATS)[number]

export const DefaultsSchema = z
  .object({
    format: z.enum(ALLOWED_FORMATS).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  })
  .default({})

export const StateSchema = z
  .object({
    current_app: z.string().optional(),
  })
  .default({})

export const ConfigFileSchema = z.object({
  schema_version: z.number().int().nonnegative().default(0),
  defaults: DefaultsSchema,
  state: StateSchema,
})

export type ConfigFile = z.infer<typeof ConfigFileSchema>

export function emptyConfig(): ConfigFile {
  return ConfigFileSchema.parse({})
}
