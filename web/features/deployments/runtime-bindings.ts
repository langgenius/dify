import type { ReleaseRuntimeBinding } from '@dify/contracts/enterprise/types.gen'

export function runtimeBindingSummary(binding?: ReleaseRuntimeBinding) {
  return binding?.name || binding?.displayValue || binding?.kind || '—'
}

export function isRuntimeEnvVarBinding(binding?: ReleaseRuntimeBinding) {
  return (binding?.kind?.toLowerCase() ?? '').includes('env')
}

export function isRuntimeModelBinding(binding?: ReleaseRuntimeBinding) {
  return (binding?.kind?.toLowerCase() ?? '').includes('model')
}

export function isRuntimePluginBinding(binding?: ReleaseRuntimeBinding) {
  return !isRuntimeEnvVarBinding(binding) && !isRuntimeModelBinding(binding)
}
