'use client'

import type { AccessPolicyResourceType } from '@/models/access-control'
import PermissionGroupList from '../../permission-group-list'
import { usePermissionsGroups } from './hooks'

type PermissionPickerProps = {
  resourceType: AccessPolicyResourceType
  value: string[]
  onChange: (next: string[]) => void
  className?: string
  readonly?: boolean
}

const PermissionPicker = ({
  resourceType,
  value,
  onChange,
  className,
  readonly = false,
}: PermissionPickerProps) => {
  const { groups } = usePermissionsGroups(resourceType)

  return (
    <PermissionGroupList
      groups={groups}
      value={value}
      onChange={onChange}
      className={className}
      readonly={readonly}
    />
  )
}

export default PermissionPicker
