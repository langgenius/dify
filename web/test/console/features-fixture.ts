import type { GetFeaturesResponse } from '@dify/contracts/api/console/features/types.gen'
import type { DeepPartial } from '@/test/console/system-features'
import { zGetFeaturesResponse } from '@dify/contracts/api/console/features/zod.gen'

export const createFeaturesFixture = (
  overrides: DeepPartial<GetFeaturesResponse> = {},
): GetFeaturesResponse => zGetFeaturesResponse.parse({ end_user_auth_enabled: false, ...overrides })
