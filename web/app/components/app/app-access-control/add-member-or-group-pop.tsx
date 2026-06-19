'use client'

import {
  AccessSubjectAddButton,
} from './access-subject-selector/add-button'
import { useAccessControlStore } from './store'

export function AddMemberOrGroupDialog({ disabled = false }: {
  disabled?: boolean
}) {
  const specificGroups = useAccessControlStore(s => s.specificGroups)
  const setSpecificGroups = useAccessControlStore(s => s.setSpecificGroups)
  const specificMembers = useAccessControlStore(s => s.specificMembers)
  const setSpecificMembers = useAccessControlStore(s => s.setSpecificMembers)
  const selectedGroupsForBreadcrumb = useAccessControlStore(s => s.selectedGroupsForBreadcrumb)
  const setSelectedGroupsForBreadcrumb = useAccessControlStore(s => s.setSelectedGroupsForBreadcrumb)

  return (
    <AccessSubjectAddButton
      selectedGroups={specificGroups}
      selectedMembers={specificMembers}
      disabled={disabled}
      breadcrumbGroups={selectedGroupsForBreadcrumb}
      onBreadcrumbGroupsChange={setSelectedGroupsForBreadcrumb}
      onChange={({ groups, members }) => {
        setSpecificGroups(groups)
        setSpecificMembers(members)
      }}
    />
  )
}
