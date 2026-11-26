import type { GetFeaturesResponse } from '@dify/contracts/api/console/features/types.gen'

// Show an Evaluation entry when the workspace can use it, or can unlock it by upgrading; the
// page then previews sample data with an upgrade prompt.
export const selectEvaluationEntryVisible = (features: GetFeaturesResponse) =>
  features.evaluation_enabled || features.evaluation_upgrade_available
