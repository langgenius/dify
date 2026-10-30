import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import { ALL_PLANS } from '@/app/components/billing/config'

/**
 * Parse vectorSpace string from ALL_PLANS config and convert to MB
 * @example "50MB" -> 50, "5GB" -> 5120, "20GB" -> 20480
 */
export const parseVectorSpaceToMB = (vectorSpace: string): number => {
  const match = /^(\d+)(MB|GB)$/i.exec(vectorSpace)
  if (!match) return 0

  const value = Number.parseInt(match[1]!, 10)
  const unit = match[2]!.toUpperCase()

  return unit === 'GB' ? value * 1024 : value
}

/**
 * Get the vector space limit in MB for a given plan type from ALL_PLANS config
 */
export const getPlanVectorSpaceLimitMB = (planType: CloudPlan): number => {
  return parseVectorSpaceToMB(ALL_PLANS[planType].vectorSpace)
}
