import { env } from '@/env'

export const isAgentV2Enabled = () => env.NEXT_PUBLIC_ENABLE_AGENT_V2

export const isAgentV2InChatflowEnabled = () => env.NEXT_PUBLIC_ENABLE_AGENT_V2_IN_CHATFLOW
