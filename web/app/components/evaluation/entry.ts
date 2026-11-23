import type { GetFeaturesResponse } from '@dify/contracts/api/console/features/types.gen'

// Show an Evaluation entry when the workspace can use it or unlock it by upgrading, and mark the upgrade case.
export const selectEvaluationEntry = (features: GetFeaturesResponse) => ({
  visible: features.evaluation_enabled || features.evaluation_upgrade_available,
  requiresUpgrade: features.evaluation_upgrade_available,
})
