import type { GetFeaturesResponse } from '@dify/contracts/api/console/features/types.gen'

export const selectIMCentrallyManaged = (features: GetFeaturesResponse) =>
  // Older feature contracts omit this capability; only an explicit backend true enables it.
  'im_centrally_managed' in features && features.im_centrally_managed === true
