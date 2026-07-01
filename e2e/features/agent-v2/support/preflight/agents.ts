import type {
  AgentAppComposerResponse,
  AgentDriveListResponse,
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
import {
  agentBuilderFileTreeFixtureFileNames,
  agentBuilderFileTreeFixtureFiles,
  agentBuilderTestMaterials,
} from '../test-materials'
import {
  asArray,
  asRecord,
  asString,
  buildQuery,
  findConsoleResourceByName,
  hasNamedOrKeyedEntry,
  skipBlockedPrecondition,
} from './common'
import { skipMissingReadyPreseededDataset } from './datasets'
import { skipMissingAgentBuilderStableChatModel } from './models'
import {
  findToolEntry,
  hasToolEntry,
  hasUnauthorizedToolCredentialState,
  skipMissingPreseededTool,
  splitToolDisplayName,
} from './tools'

const hasKnowledgeDataset = (
  soul: Record<string, unknown>,
  dataset: PreseededResource,
) => {
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

    if (!hasExpectedDataset || query.mode !== queryMode)
      return false
    if (queryValue === undefined)
      return true

    return asString(query.value).trim() === queryValue
  })
}

export async function skipMissingPreseededAgent(
  world: DifyWorld,
  resourceName: string,
): Promise<'skipped' | PreseededResource> {
  const query = buildQuery({ limit: '20', name: resourceName, page: '1' })
  const resource = await findConsoleResourceByName({
    action: `Check preseeded Agent ${resourceName}`,
    path: `/console/api/agent?${query}`,
    resourceName,
  })

  if (!resource)
    return skipBlockedPrecondition(world, `Preseeded Agent "${resourceName}" was not found.`)

  return {
    id: resource.id,
    kind: 'agent',
    name: resource.name,
  }
}

export async function skipMissingPreseededWorkflow(
  world: DifyWorld,
  resourceName: string,
): Promise<'skipped' | PreseededResource> {
  const query = buildQuery({ limit: '20', mode: 'workflow', name: resourceName, page: '1' })
  const resource = await findConsoleResourceByName({
    action: `Check preseeded workflow ${resourceName}`,
    path: `/console/api/apps?${query}`,
    resourceName,
  })

  if (!resource)
    return skipBlockedPrecondition(world, `Preseeded workflow "${resourceName}" was not found.`)

  return {
    id: resource.id,
    kind: 'workflow',
    name: resource.name,
  }
}

export async function skipMissingPreseededAgentDriveSkill(
  world: DifyWorld,
  agentName: string,
  skillName: string,
): Promise<'skipped' | PreseededResource> {
  const agent = await skipMissingPreseededAgent(world, agentName)
  if (agent === 'skipped')
    return agent

  const ctx = await createApiContext()
  try {
    const response = await ctx.get(`/console/api/agent/${agent.id}/drive/skills`)
    await expectApiResponseOK(response, `Check preseeded Agent skill ${skillName}`)
    const body = (await response.json()) as AgentDriveSkillListResponse
    const skill = body.items?.find(item => item.name === skillName)

    if (!skill) {
      return skipBlockedPrecondition(
        world,
        `Preseeded Agent "${agentName}" does not include drive skill "${skillName}".`,
      )
    }

    return {
      id: skill.path,
      kind: 'skill',
      name: skill.name,
    }
  }
  finally {
    await ctx.dispose()
  }
}

export async function skipMissingPreseededFullConfigAgentCoreConfiguration(
  world: DifyWorld,
  agentName: string,
): Promise<'skipped' | PreseededResource> {
  const stableModel = await skipMissingAgentBuilderStableChatModel(world)
  if (stableModel === 'skipped')
    return stableModel

  const agent = await skipMissingPreseededAgent(world, agentName)
  if (agent === 'skipped')
    return agent

  const summarySkill = await skipMissingPreseededAgentDriveSkill(
    world,
    agentName,
    agentBuilderPreseededResources.summarySkill,
  )
  if (summarySkill === 'skipped')
    return summarySkill

  const jsonTool = await skipMissingPreseededTool(
    world,
    agentBuilderPreseededResources.jsonReplaceTool,
  )
  if (jsonTool === 'skipped')
    return jsonTool

  const knowledgeBase = await skipMissingReadyPreseededDataset(
    world,
    agentBuilderPreseededResources.agentKnowledgeBase,
  )
  if (knowledgeBase === 'skipped')
    return knowledgeBase

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
      if (!hasNamedOrKeyedEntry(files, fileName))
        missing.push(`file ${fileName}`)
    }

    const [providerName = '', toolName = ''] = jsonTool.id.split('/')
    const parsedTool = splitToolDisplayName(agentBuilderPreseededResources.jsonReplaceTool)
    if (
      parsedTool.ok
      && !hasToolEntry(asArray(asRecord(soul.tools).dify_tools), {
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
      return skipBlockedPrecondition(
        world,
        `Preseeded Agent "${agentName}" is missing core fixture configuration: ${missing.join(', ')}.`,
      )
    }

    return agent
  }
  finally {
    await ctx.dispose()
  }
}

export async function skipMissingPreseededToolStatesAgentConfiguration(
  world: DifyWorld,
  agentName: string,
): Promise<'skipped' | PreseededResource> {
  const agent = await skipMissingPreseededAgent(world, agentName)
  if (agent === 'skipped')
    return agent

  const summarySkill = await skipMissingPreseededAgentDriveSkill(
    world,
    agentName,
    agentBuilderPreseededResources.summarySkill,
  )
  if (summarySkill === 'skipped')
    return summarySkill

  const jsonTool = await skipMissingPreseededTool(
    world,
    agentBuilderPreseededResources.jsonReplaceTool,
  )
  if (jsonTool === 'skipped')
    return jsonTool

  const tavilyTool = await skipMissingPreseededTool(
    world,
    agentBuilderPreseededResources.tavilySearchTool,
  )
  if (tavilyTool === 'skipped')
    return tavilyTool

  const ctx = await createApiContext()
  try {
    const response = await ctx.get(`/console/api/agent/${agent.id}/composer`)
    await expectApiResponseOK(response, `Check preseeded Agent tool states ${agentName}`)
    const body = (await response.json()) as AgentAppComposerResponse
    const soul = body.agent_soul ?? {}
    const toolItems = asArray(asRecord(soul.tools).dify_tools)
    const missing: string[] = []

    const [jsonProviderName = '', jsonToolName = ''] = jsonTool.id.split('/')
    const parsedJsonTool = splitToolDisplayName(agentBuilderPreseededResources.jsonReplaceTool)
    if (
      parsedJsonTool.ok
      && !findToolEntry(toolItems, {
        providerDisplayName: parsedJsonTool.providerName,
        providerName: jsonProviderName,
        toolDisplayName: parsedJsonTool.toolName,
        toolName: jsonToolName,
      })
    ) {
      missing.push(agentBuilderPreseededResources.jsonReplaceTool)
    }

    const [tavilyProviderName = '', tavilyToolName = ''] = tavilyTool.id.split('/')
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
    }
    else if (!hasUnauthorizedToolCredentialState(tavilyEntry)) {
      missing.push(`${agentBuilderPreseededResources.tavilySearchTool} unauthorized credential state`)
    }

    if (missing.length > 0) {
      return skipBlockedPrecondition(
        world,
        `Preseeded Agent "${agentName}" is missing tool state fixture configuration: ${missing.join(', ')}.`,
      )
    }

    return agent
  }
  finally {
    await ctx.dispose()
  }
}

export async function skipMissingPreseededDualRetrievalAgentConfiguration(
  world: DifyWorld,
  agentName: string,
): Promise<'skipped' | PreseededResource> {
  const agent = await skipMissingPreseededAgent(world, agentName)
  if (agent === 'skipped')
    return agent

  const knowledgeBase = await skipMissingReadyPreseededDataset(
    world,
    agentBuilderPreseededResources.agentKnowledgeBase,
  )
  if (knowledgeBase === 'skipped')
    return knowledgeBase

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
      return skipBlockedPrecondition(
        world,
        `Preseeded Agent "${agentName}" is missing dual retrieval fixture configuration: ${missing.join(', ')}.`,
      )
    }

    return agent
  }
  finally {
    await ctx.dispose()
  }
}

export async function skipMissingPreseededAgentFileTreeFixture(
  world: DifyWorld,
  agentName: string,
): Promise<'skipped' | PreseededResource> {
  const agent = await skipMissingPreseededAgent(world, agentName)
  if (agent === 'skipped')
    return agent

  const ctx = await createApiContext()
  try {
    const query = buildQuery({ prefix: 'files/' })
    const response = await ctx.get(`/console/api/agent/${agent.id}/drive/files?${query}`)
    await expectApiResponseOK(response, `Check preseeded Agent file tree ${agentName}`)
    const body = (await response.json()) as AgentDriveListResponse
    const keys = (body.items ?? []).map(item => item.key)
    const missingFiles = agentBuilderFileTreeFixtureFiles.filter(
      filePath =>
        !keys.some(key => key === `files/${filePath}` || key.endsWith(`/${filePath}`)),
    )

    if (missingFiles.length > 0) {
      return skipBlockedPrecondition(
        world,
        `Preseeded Agent "${agentName}" is missing file tree fixture files: ${missingFiles.join(', ')}.`,
      )
    }

    return {
      id: agent.id,
      kind: 'agent',
      name: agent.name,
    }
  }
  finally {
    await ctx.dispose()
  }
}

export async function skipMissingPreseededAgentFlatFileFixtureConfiguration(
  world: DifyWorld,
  agentName: string,
): Promise<'skipped' | PreseededResource> {
  const agent = await skipMissingPreseededAgent(world, agentName)
  if (agent === 'skipped')
    return agent

  const ctx = await createApiContext()
  try {
    const response = await ctx.get(`/console/api/agent/${agent.id}/composer`)
    await expectApiResponseOK(response, `Check preseeded Agent flat file fixture ${agentName}`)
    const body = (await response.json()) as AgentAppComposerResponse
    const configFiles = Array.isArray(body.agent_soul?.config_files)
      ? body.agent_soul.config_files
      : []
    const fileNames = configFiles
      .map(file => (typeof file === 'object' && file !== null && 'name' in file ? file.name : undefined))
      .filter((name): name is string => typeof name === 'string')
    const missingFiles = agentBuilderFileTreeFixtureFileNames.filter(fileName => !fileNames.includes(fileName))

    if (missingFiles.length > 0) {
      return skipBlockedPrecondition(
        world,
        `Preseeded Agent "${agentName}" is missing current flat Files fixture configuration: ${missingFiles.join(', ')}. Hierarchical Files display remains blocked until Agent config files support tree paths.`,
      )
    }

    return {
      id: agent.id,
      kind: 'agent',
      name: agent.name,
    }
  }
  finally {
    await ctx.dispose()
  }
}
