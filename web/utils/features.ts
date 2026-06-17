import { env } from '@/env'

export type FeatureKey = 'agentV2'

const featureFlags = {
  agentV2: env.NEXT_PUBLIC_ENABLE_AGENT_V2,
} satisfies Record<FeatureKey, boolean>

export const isFeatureEnabled = (feature: FeatureKey) => featureFlags[feature]

export const isAgentV2Enabled = () => isFeatureEnabled('agentV2')
