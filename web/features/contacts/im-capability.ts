import type { GetFeaturesResponse } from '@dify/contracts/api/console/features/types.gen'

export const selectIMCentrallyManaged = (features: GetFeaturesResponse) =>
  features.im_centrally_managed
