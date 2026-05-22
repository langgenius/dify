import type { RequiredSlot } from '@dify/contracts/enterprise/types.gen'

const SLOT_TYPE_PLUGIN_CREDENTIAL = 1
const SLOT_TYPE_ENV_VAR = 2

export function runtimeBindingSummary(binding?: RequiredSlot) {
  return binding?.name || binding?.providerId || '—'
}

export function isRuntimeEnvVarBinding(binding?: RequiredSlot) {
  return binding?.type === SLOT_TYPE_ENV_VAR
}

export function isRuntimeModelBinding(binding?: RequiredSlot) {
  return binding?.type === SLOT_TYPE_PLUGIN_CREDENTIAL
}

export function isRuntimePluginBinding(binding?: RequiredSlot) {
  return !isRuntimeEnvVarBinding(binding) && !isRuntimeModelBinding(binding)
}
