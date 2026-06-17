import type {
  CredentialCandidate,
  CredentialSelectionInput,
  CredentialSlot,
} from '@dify/contracts/enterprise/types.gen'

export type RuntimeCredentialBindingSelections = Record<string, string>

export type RuntimeCredentialSelectOption = {
  value: string
  label: string
}

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  azure_openai: 'Azure OpenAI',
  bedrock: 'Amazon Bedrock',
  gemini: 'Gemini',
  google: 'Google',
  openai: 'OpenAI',
  vertex_ai: 'Vertex AI',
  volcengine_maas: 'Volcengine',
}

function providerSlug(providerId: string) {
  const parts = providerId.split('/').filter(Boolean)
  return parts[parts.length - 1]
}

function titleCaseProviderName(value: string) {
  return value
    .split(/[-_]/)
    .filter(Boolean)
    .map(part => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

export function runtimeCredentialSlotKey(slot: CredentialSlot) {
  return [slot.providerId, slot.category].join(':')
}

export function runtimeCredentialProviderName(providerId: string) {
  const slug = providerSlug(providerId)
  if (!slug)
    return undefined

  return PROVIDER_DISPLAY_NAMES[slug.toLowerCase()] ?? titleCaseProviderName(slug)
}

function runtimeCredentialCandidateLabel(candidate: CredentialCandidate) {
  const fallback = candidate.credentialId
  const rawLabel = candidate.displayName.trim() || fallback
  const providerId = candidate.providerId.trim()

  const providerSuffixes = [
    ` · ${providerId}`,
    ` - ${providerId}`,
    ` (${providerId})`,
  ]
  const label = providerSuffixes.reduce((nextLabel, suffix) => {
    return nextLabel.endsWith(suffix)
      ? nextLabel.slice(0, -suffix.length).trim()
      : nextLabel
  }, rawLabel)

  return label || fallback
}

export function runtimeCredentialCandidateOptions(slot: CredentialSlot): RuntimeCredentialSelectOption[] {
  return slot.candidates.map(candidate => ({
    value: candidate.credentialId,
    label: runtimeCredentialCandidateLabel(candidate),
  }))
}

export function hasMissingRequiredRuntimeCredentialBinding(_slot: CredentialSlot, selectedValue?: string) {
  return !selectedValue
}

export function selectedRuntimeCredentialSelections(
  slots: CredentialSlot[],
  manualBindings: RuntimeCredentialBindingSelections,
): RuntimeCredentialBindingSelections {
  const next: RuntimeCredentialBindingSelections = {}
  for (const slot of slots) {
    const slotKey = runtimeCredentialSlotKey(slot)
    const candidates = runtimeCredentialCandidateOptions(slot)
    const existing = manualBindings[slotKey]
    if (existing && candidates.some(candidate => candidate.value === existing))
      next[slotKey] = existing
    else if (slot.lastCredentialId && candidates.some(candidate => candidate.value === slot.lastCredentialId))
      next[slotKey] = slot.lastCredentialId
    else if (candidates.length === 1 && candidates[0])
      next[slotKey] = candidates[0].value
  }
  return next
}

export function selectedDeploymentRuntimeCredentials(
  slots: CredentialSlot[],
  selections: RuntimeCredentialBindingSelections,
): CredentialSelectionInput[] {
  return slots
    .flatMap((slot): CredentialSelectionInput[] => {
      const slotKey = runtimeCredentialSlotKey(slot)
      const selectedValue = selections[slotKey]
      if (!selectedValue)
        return []

      return [{
        providerId: slot.providerId,
        category: slot.category,
        credentialId: selectedValue,
      }]
    })
}
