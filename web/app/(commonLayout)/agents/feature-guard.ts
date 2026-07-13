import { env } from '@/env'
import { notFound } from '@/next/navigation'

export const guardAgentV2Route = () => {
  if (!env.NEXT_PUBLIC_ENABLE_AGENT_V2) notFound()
}
