import type { AccessControlAccount, AccessControlGroup } from '@/models/access-control'

export type AccessSubjectSelectionValue = {
  groups: AccessControlGroup[]
  members: AccessControlAccount[]
}

export type AccessSubjectSelectionProps = {
  selectedGroups: AccessControlGroup[]
  selectedMembers: AccessControlAccount[]
  onChange: (value: AccessSubjectSelectionValue) => void
}
