import type { DifyWorld } from '../../../support/world'
import type { LocalizedLabel, PreseededResource } from './common'
import { createApiContext, expectApiResponseOK } from '../../../../support/api'
import {
  asRecord,
  asString,

  matchesNameOrLabel,

  skipBlockedPrecondition,
} from './common'

type BuiltinToolProvider = {
  label?: LocalizedLabel
  name: string
  tools: Array<{
    label?: LocalizedLabel
    name: string
  }>
}

export const splitToolDisplayName = (resourceName: string) => {
  const [providerName, toolName] = resourceName.split('/').map(item => item.trim())

  if (!providerName || !toolName) {
    return {
      ok: false as const,
      reason: `Preseeded tool "${resourceName}" must use "Provider / Tool" format.`,
    }
  }

  return {
    ok: true as const,
    providerName,
    toolName,
  }
}

export const findToolEntry = (
  items: unknown[],
  {
    providerDisplayName,
    providerName,
    toolDisplayName,
    toolName,
  }: {
    providerDisplayName: string
    providerName: string
    toolDisplayName: string
    toolName: string
  },
) =>
  items.find((item) => {
    const record = asRecord(item)
    const providerValues = [record.provider_id, record.provider, record.plugin_id, record.name].map(
      asString,
    )
    const toolValues = [record.tool_name, record.name].map(asString)

    return (
      providerValues.some(value => value === providerName || value === providerDisplayName)
      && toolValues.some(value => value === toolName || value === toolDisplayName)
    )
  })

export const hasToolEntry = (
  items: unknown[],
  tool: {
    providerDisplayName: string
    providerName: string
    toolDisplayName: string
    toolName: string
  },
) => Boolean(findToolEntry(items, tool))

export const hasUnauthorizedToolCredentialState = (item: unknown) => {
  const record = asRecord(item)

  return asString(record.credential_type) === 'unauthorized'
}

export async function skipMissingPreseededTool(
  world: DifyWorld,
  resourceName: string,
): Promise<'skipped' | PreseededResource> {
  const parsed = splitToolDisplayName(resourceName)
  if (!parsed.ok)
    return skipBlockedPrecondition(world, parsed.reason)

  const ctx = await createApiContext()
  try {
    const response = await ctx.get('/console/api/workspaces/current/tools/builtin')
    await expectApiResponseOK(response, `Check preseeded tool ${resourceName}`)
    const providers = (await response.json()) as BuiltinToolProvider[]
    const provider = providers.find(item =>
      matchesNameOrLabel(parsed.providerName, item.name, item.label),
    )
    const tool = provider?.tools.find(item =>
      matchesNameOrLabel(parsed.toolName, item.name, item.label),
    )

    if (!provider || !tool)
      return skipBlockedPrecondition(world, `Preseeded tool "${resourceName}" was not found.`)

    return {
      id: `${provider.name}/${tool.name}`,
      kind: 'tool',
      name: resourceName,
    }
  }
  finally {
    await ctx.dispose()
  }
}
