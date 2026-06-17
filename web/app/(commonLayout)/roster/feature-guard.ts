import { notFound } from '@/next/navigation'
import { isAgentV2Enabled } from '@/utils/features'

export const guardAgentV2Route = () => {
  if (!isAgentV2Enabled())
    notFound()
}
