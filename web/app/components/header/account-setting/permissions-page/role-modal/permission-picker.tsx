'use client'

import PermissionGroupList from '../../permission-group-list'
import { useWorkspacePermissionGroups } from './hooks'

type PermissionPickerProps = {
  value: string[]
  onChange: (next: string[]) => void
  className?: string
  readonly?: boolean
}

const PermissionPicker = ({
  value,
  onChange,
  className,
  readonly = false,
}: PermissionPickerProps) => {
  const { groups } = useWorkspacePermissionGroups()

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
