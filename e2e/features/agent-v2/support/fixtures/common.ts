import type { DifyWorld } from '../../../support/world'
import { createApiContext, expectApiResponseOK } from '../../../../support/api'

export type PreseededResource = NonNullable<
  DifyWorld['agentBuilder']['fixtures']['preseededResources'][string]
>

export type NamedResource = {
  id: string
  name: string
}

export type NamedResourceCollection<T extends NamedResource = NamedResource> = {
  data: T[]
}

export type LocalizedLabel = {
  en_US?: string
  zh_Hans?: string
}

export function failFixturePrerequisite(
  world: DifyWorld,
  reason: string,
  options: {
    owner?: string
    remediation?: string
  } = {},
): never {
  const owner = options.owner ?? 'seed/product'
  const remediation =
    options.remediation ??
    'Seed the required resource or align the product capability before running this scenario.'
  const message = `Fixture prerequisite failed: ${reason} Owner: ${owner}. Remediation: ${remediation}`
  world.attach(message, 'text/plain')
  throw new Error(message)
}

export const findConsoleResourceByName = async <T extends NamedResource = NamedResource>({
  action,
  path,
  resourceName,
}: {
  action: string
  path: string
  resourceName: string
}) => {
  const ctx = await createApiContext()
  try {
    const response = await ctx.get(path)
    await expectApiResponseOK(response, action)
    const body = (await response.json()) as NamedResourceCollection<T>

    return body.data.find((item) => item.name === resourceName)
  } finally {
    await ctx.dispose()
  }
}

export const buildQuery = (params: Record<string, string>) => new URLSearchParams(params).toString()

export const matchesNameOrLabel = (value: string, name: string, label?: LocalizedLabel) =>
  value === name || value === label?.en_US || value === label?.zh_Hans

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const asRecord = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {})

export const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

export const asString = (value: unknown) => (typeof value === 'string' ? value : '')

export const hasNamedOrKeyedEntry = (items: unknown[], expectedName: string) =>
  items.some((item) => {
    const record = asRecord(item)
    const values = [record.name, record.drive_key, record.reference, record.file_id, record.id].map(
      asString,
    )

    return values.some((value) => value === expectedName || value.endsWith(`/${expectedName}`))
  })
