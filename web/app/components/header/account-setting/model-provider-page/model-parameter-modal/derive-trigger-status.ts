import type { DerivedModelStatus } from '../derive-model-status'
import {
  DERIVED_MODEL_STATUS_BADGE_I18N,
  DERIVED_MODEL_STATUS_TOOLTIP_I18N,
  deriveModelStatus,
} from '../derive-model-status'

export type TriggerStatus = DerivedModelStatus

export const deriveTriggerStatus = deriveModelStatus
export const TRIGGER_STATUS_BADGE_I18N = DERIVED_MODEL_STATUS_BADGE_I18N
export const TRIGGER_STATUS_TOOLTIP_I18N = DERIVED_MODEL_STATUS_TOOLTIP_I18N
