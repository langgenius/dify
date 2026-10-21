import type { GetFeaturesResponse } from '@dify/contracts/api/console/features/types.gen'

export const selectIMBindingCentrallyManaged = (features: GetFeaturesResponse) =>
  // Older feature contracts omit this capability; only an explicit backend true enables it.
  'im_binding_centrally_managed' in features && features.im_binding_centrally_managed === true
