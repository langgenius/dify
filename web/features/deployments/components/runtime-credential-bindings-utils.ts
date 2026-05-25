import type {
  CredentialSelectionInput,
  CredentialSlot,
} from '@dify/contracts/enterprise/types.gen'

export type RuntimeCredentialBindingSelections = Record<string, string>

export type RuntimeCredentialSelectOption = {
  value: string
  label: string
}

export function runtimeCredentialSlotKey(slot: CredentialSlot) {
  return [slot.providerId ?? '', slot.category ?? ''].join(':')
}

export function runtimeCredentialCandidateOptions(slot: CredentialSlot): RuntimeCredentialSelectOption[] {
  return (slot.candidates ?? [])
    .filter(candidate => candidate.credentialId)
    .map(candidate => ({
      value: candidate.credentialId!,
      label: [
        candidate.displayName,
        candidate.providerId,
      ].filter(Boolean).join(' · ') || candidate.credentialId!,
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
    .map((slot): CredentialSelectionInput | undefined => {
      const slotKey = runtimeCredentialSlotKey(slot)
      const selectedValue = selections[slotKey]
      if (!slotKey || !selectedValue)
        return undefined

      return {
        providerId: slot.providerId,
        category: slot.category,
        credentialId: selectedValue,
      }
    })
    .filter((binding): binding is CredentialSelectionInput => Boolean(binding))
}
