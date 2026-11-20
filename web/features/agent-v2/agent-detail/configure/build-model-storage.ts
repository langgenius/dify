import type {
  AgentSoulModelConfig,
  AgentSoulModelSettings,
} from '@dify/contracts/api/console/agent/types.gen'
import { createLocalStorageState } from 'foxact/create-local-storage-state'
import { useCallback } from 'react'

// The Build model is a per-browser authoring preference keyed by Agent ID. It is
// sent with Build chat requests only and is never written to the Agent config.
type AgentBuildModels = Record<string, AgentSoulModelConfig>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0

const toBuildModel = (value: unknown): AgentSoulModelConfig | undefined => {
  if (!isRecord(value)) return undefined

  const { plugin_id, model_provider, model, model_settings } = value
  if (!isNonEmptyString(plugin_id) || !isNonEmptyString(model_provider) || !isNonEmptyString(model))
    return undefined

  return {
    plugin_id,
    model_provider,
    model,
    ...(isRecord(model_settings) && {
      model_settings: model_settings as AgentSoulModelSettings,
    }),
  }
}

// Unreadable entries fall back to the Agent model instead of sending an invalid override.
const deserializeAgentBuildModels = (value: string): AgentBuildModels => {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!isRecord(parsed)) return {}

    return Object.fromEntries(
      Object.entries(parsed).flatMap(([agentId, buildModel]) => {
        const validBuildModel = toBuildModel(buildModel)
        return validBuildModel ? [[agentId, validBuildModel]] : []
      }),
    )
  } catch {
    return {}
  }
}

const emptyAgentBuildModels: AgentBuildModels = {}

const [useAgentBuildModelsStorage] = createLocalStorageState<AgentBuildModels>(
  'agent-v2-build-models',
  emptyAgentBuildModels,
  {
    serializer: (value) => JSON.stringify(value),
    deserializer: deserializeAgentBuildModels,
  },
)

/**
 * Returns the Build model chosen for this Agent in this browser, or `undefined`
 * when Build chat follows the Agent model. Setting `undefined` clears the choice.
 */
export function useAgentBuildModel(agentId: string) {
  const [buildModels, setBuildModels] = useAgentBuildModelsStorage()
  const setBuildModel = useCallback(
    (buildModel: AgentSoulModelConfig | undefined) => {
      setBuildModels((current) => {
        const { [agentId]: _previous, ...otherAgents } = current ?? emptyAgentBuildModels
        return buildModel ? { ...otherAgents, [agentId]: buildModel } : otherAgents
      })
    },
    [agentId, setBuildModels],
  )

  return [buildModels[agentId], setBuildModel] as const
}
