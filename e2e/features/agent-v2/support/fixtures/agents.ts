import type {
  AgentAppComposerResponse,
  AgentDriveSkillListResponse,
} from '@dify/contracts/api/console/agent/types.gen'
import type { DifyWorld } from '../../../support/world'
import type { PreseededResource } from './common'
import { createApiContext, expectApiResponseOK } from '../../../../support/api'
import {
  agentBuilderExpectedTokens,
  agentBuilderFixedInputs,
  agentBuilderPreseededResources,
} from '../agent-builder-resources'
import { agentBuilderTestMaterials } from '../test-materials'
import {
  asArray,
  asRecord,
  asString,
  buildQuery,
  failFixturePrerequisite,
  findConsoleResourceByName,
  hasNamedOrKeyedEntry,
} from './common'
import { requireReadyPreseededDataset } from './datasets'
import { requireAgentBuilderStableChatModel } from './models'
import {
  findToolEntry,
  hasToolEntry,
  hasUnauthorizedToolCredentialState,
  requirePreseededTool,
  splitToolDisplayName,
  splitToolResourceId,
} from './tools'

const hasKnowledgeDataset = (soul: Record<string, unknown>, dataset: PreseededResource) => {
  const knowledge = asRecord(soul.knowledge)
  const sets = asArray(knowledge.sets)

  return sets.some((set) => {
    const datasets = asArray(asRecord(set).datasets)

    return datasets.some((item) => {
      const record = asRecord(item)
      return record.id === dataset.id || record.name === dataset.name
    })
  })
}

const hasKnowledgeSet = (
  soul: Record<string, unknown>,
  dataset: PreseededResource,
  {
    queryMode,
    queryValue,
  }: {
    queryMode: 'generated_query' | 'user_query'
    queryValue?: string
  },
) => {
  const knowledge = asRecord(soul.knowledge)
  const sets = asArray(knowledge.sets)

  return sets.some((set) => {
    const record = asRecord(set)
    const query = asRecord(record.query)
    const datasets = asArray(record.datasets)
    const hasExpectedDataset = datasets.some((item) => {
      const datasetRecord = asRecord(item)
      return datasetRecord.id === dataset.id || datasetRecord.name === dataset.name
    })

    if (!hasExpectedDataset || query.mode !== queryMode) return false
    if (queryValue === undefined) return true

    return asString(query.value).trim() === queryValue
  })
}

export async function requirePreseededAgent(
  world: DifyWorld,
  resourceName: string,
): Promise<PreseededResource> {
  const query = buildQuery({ limit: '20', name: resourceName, page: '1' })
  const resource = await findConsoleResourceByName({
    action: `Check preseeded Agent ${resourceName}`,
    path: `/console/api/agent?${query}`,
    resourceName,
  })

  if (!resource)
    return failFixturePrerequisite(world, `Preseeded Agent "${resourceName}" was not found.`)

  return {
    id: resource.id,
    kind: 'agent',
    name: resource.name,
  }
}

export async function requirePreseededWorkflow(
  world: DifyWorld,
  resourceName: string,
): Promise<PreseededResource> {
  const query = buildQuery({ limit: '20', mode: 'workflow', name: resourceName, page: '1' })
  const resource = await findConsoleResourceByName({
    action: `Check preseeded workflow ${resourceName}`,
    path: `/console/api/apps?${query}`,
    resourceName,
  })

  if (!resource)
    return failFixturePrerequisite(world, `Preseeded workflow "${resourceName}" was not found.`)

  return {
    id: resource.id,
    kind: 'workflow',
    name: resource.name,
  }
}

export async function requirePreseededAgentDriveSkill(
  world: DifyWorld,
  agentName: string,
  skillName: string,
): Promise<PreseededResource> {
  const agent = await requirePreseededAgent(world, agentName)

  const ctx = await createApiContext()
  try {
    const response = await ctx.get(`/console/api/agent/${agent.id}/drive/skills`)
    await expectApiResponseOK(response, `Check preseeded Agent skill ${skillName}`)
    const body = (await response.json()) as AgentDriveSkillListResponse
    const skill = body.items?.find((item) => item.name === skillName)

    if (!skill) {
      return failFixturePrerequisite(
        world,
        `Preseeded Agent "${agentName}" does not include drive skill "${skillName}".`,
      )
    }

    return {
      id: skill.path,
      kind: 'skill',
      name: skill.name,
    }
  } finally {
    await ctx.dispose()
  }
}

export async function requirePreseededFullConfigAgentCoreConfiguration(
  world: DifyWorld,
  agentName: string,
): Promise<PreseededResource> {
  const stableModel = await requireAgentBuilderStableChatModel(world)

  const agent = await requirePreseededAgent(world, agentName)

  await requirePreseededAgentDriveSkill(
    world,
    agentName,
    agentBuilderPreseededResources.summarySkill,
  )

  const jsonTool = await requirePreseededTool(world, agentBuilderPreseededResources.jsonReplaceTool)

  const knowledgeBase = await requireReadyPreseededDataset(
    world,
    agentBuilderPreseededResources.agentKnowledgeBase,
  )

  const ctx = await createApiContext()
  try {
    const response = await ctx.get(`/console/api/agent/${agent.id}/composer`)
    await expectApiResponseOK(response, `Check preseeded Agent core configuration ${agentName}`)
    const body = (await response.json()) as AgentAppComposerResponse
    const soul = body.agent_soul ?? {}
    const missing: string[] = []

    const model = asRecord(soul.model)
    if (model.model_provider !== stableModel.provider || model.model !== stableModel.name)
      missing.push(`${agentBuilderPreseededResources.stableChatModel} model config`)

    const prompt = asString(asRecord(soul.prompt).system_prompt)
    if (!prompt.includes(agentBuilderExpectedTokens.agentReply))
      missing.push(`Prompt token ${agentBuilderExpectedTokens.agentReply}`)

    const files = asArray(soul.config_files)
    for (const fileName of [
      agentBuilderTestMaterials.smallFile,
      agentBuilderTestMaterials.specialFilename,
    ]) {
      if (!hasNamedOrKeyedEntry(files, fileName)) missing.push(`file ${fileName}`)
    }

    const skills = asArray(soul.config_skills)
    if (!hasNamedOrKeyedEntry(skills, agentBuilderPreseededResources.summarySkill))
      missing.push(agentBuilderPreseededResources.summarySkill)

    const { providerName, toolName } = splitToolResourceId(jsonTool.id)
    const parsedTool = splitToolDisplayName(agentBuilderPreseededResources.jsonReplaceTool)
    if (
      parsedTool.ok &&
      !hasToolEntry(asArray(asRecord(soul.tools).dify_tools), {
        providerDisplayName: parsedTool.providerName,
        providerName,
        toolDisplayName: parsedTool.toolName,
        toolName,
      })
    ) {
      missing.push(agentBuilderPreseededResources.jsonReplaceTool)
    }

    if (!hasKnowledgeDataset(soul, knowledgeBase))
      missing.push(agentBuilderPreseededResources.agentKnowledgeBase)

    if (missing.length > 0) {
      return failFixturePrerequisite(
        world,
        `Preseeded Agent "${agentName}" is missing core fixture configuration: ${missing.join(', ')}.`,
      )
    }

    return agent
  } finally {
    await ctx.dispose()
  }
}

export async function requirePreseededToolStatesAgentConfiguration(
  world: DifyWorld,
  agentName: string,
): Promise<PreseededResource> {
  const agent = await requirePreseededAgent(world, agentName)

  await requirePreseededAgentDriveSkill(
    world,
    agentName,
    agentBuilderPreseededResources.summarySkill,
  )

  const jsonTool = await requirePreseededTool(world, agentBuilderPreseededResources.jsonReplaceTool)

  const tavilyTool = await requirePreseededTool(
    world,
    agentBuilderPreseededResources.tavilySearchTool,
  )

  const ctx = await createApiContext()
  try {
    const response = await ctx.get(`/console/api/agent/${agent.id}/composer`)
    await expectApiResponseOK(response, `Check preseeded Agent tool states ${agentName}`)
    const body = (await response.json()) as AgentAppComposerResponse
    const soul = body.agent_soul ?? {}
    const toolItems = asArray(asRecord(soul.tools).dify_tools)
    const missing: string[] = []

    const skills = asArray(soul.config_skills)
    if (!hasNamedOrKeyedEntry(skills, agentBuilderPreseededResources.summarySkill))
      missing.push(agentBuilderPreseededResources.summarySkill)

    const { providerName: jsonProviderName, toolName: jsonToolName } = splitToolResourceId(
      jsonTool.id,
    )
    const parsedJsonTool = splitToolDisplayName(agentBuilderPreseededResources.jsonReplaceTool)
    if (
      parsedJsonTool.ok &&
      !findToolEntry(toolItems, {
        providerDisplayName: parsedJsonTool.providerName,
        providerName: jsonProviderName,
        toolDisplayName: parsedJsonTool.toolName,
        toolName: jsonToolName,
      })
    ) {
      missing.push(agentBuilderPreseededResources.jsonReplaceTool)
    }

    const { providerName: tavilyProviderName, toolName: tavilyToolName } = splitToolResourceId(
      tavilyTool.id,
    )
    const parsedTavilyTool = splitToolDisplayName(agentBuilderPreseededResources.tavilySearchTool)
    const tavilyEntry = parsedTavilyTool.ok
      ? findToolEntry(toolItems, {
          providerDisplayName: parsedTavilyTool.providerName,
          providerName: tavilyProviderName,
          toolDisplayName: parsedTavilyTool.toolName,
          toolName: tavilyToolName,
        })
      : undefined

    if (!tavilyEntry) {
      missing.push(agentBuilderPreseededResources.tavilySearchTool)
    } else if (!hasUnauthorizedToolCredentialState(tavilyEntry)) {
      missing.push(
        `${agentBuilderPreseededResources.tavilySearchTool} unauthorized credential state`,
      )
    }

    if (missing.length > 0) {
      return failFixturePrerequisite(
        world,
        `Preseeded Agent "${agentName}" is missing tool state fixture configuration: ${missing.join(', ')}.`,
      )
    }

    return agent
  } finally {
    await ctx.dispose()
  }
}

export async function requirePreseededDualRetrievalAgentConfiguration(
  world: DifyWorld,
  agentName: string,
): Promise<PreseededResource> {
  const agent = await requirePreseededAgent(world, agentName)

  const knowledgeBase = await requireReadyPreseededDataset(
    world,
    agentBuilderPreseededResources.agentKnowledgeBase,
  )

  const ctx = await createApiContext()
  try {
    const response = await ctx.get(`/console/api/agent/${agent.id}/composer`)
    await expectApiResponseOK(response, `Check preseeded Agent dual retrieval ${agentName}`)
    const body = (await response.json()) as AgentAppComposerResponse
    const soul = body.agent_soul ?? {}
    const missing: string[] = []

    if (!hasKnowledgeSet(soul, knowledgeBase, { queryMode: 'generated_query' }))
      missing.push('Agent decide Knowledge Retrieval')

    if (
      !hasKnowledgeSet(soul, knowledgeBase, {
        queryMode: 'user_query',
        queryValue: agentBuilderFixedInputs.customKnowledgeQuery,
      })
    ) {
      missing.push('Custom query Knowledge Retrieval')
    }

    if (missing.length > 0) {
      return failFixturePrerequisite(
        world,
        `Preseeded Agent "${agentName}" is missing dual retrieval fixture configuration: ${missing.join(', ')}.`,
      )
    }

    return agent
  } finally {
    await ctx.dispose()
  }
}
