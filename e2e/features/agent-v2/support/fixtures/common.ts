import type { DifyWorld } from '../../../support/world'

export type PreseededResource = NonNullable<
  DifyWorld['agentBuilder']['fixtures']['preseededResources'][string]
>

export type NamedResource = {
  id: string
  name: string
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

export const findResourceByName = <T extends NamedResource>(resources: T[], resourceName: string) =>
  resources.find((item) => item.name === resourceName)

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const asRecord = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {})

export const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

export const asString = (value: unknown) => (typeof value === 'string' ? value : '')

export const matchesNameOrLabel = (value: string, name: string, label?: unknown) => {
  const localizedLabel = asRecord(label)

  return (
    value === name ||
    value === asString(localizedLabel.en_US) ||
    value === asString(localizedLabel.zh_Hans)
  )
}

export const hasNamedOrKeyedEntry = (items: unknown[], expectedName: string) =>
  items.some((item) => {
    const record = asRecord(item)
    const values = [record.name, record.drive_key, record.reference, record.file_id, record.id].map(
      asString,
    )

    return values.some((value) => value === expectedName || value.endsWith(`/${expectedName}`))
  })
