'use client'

import PermissionPicker from './permission-picker'

export type PermissionFieldProps = {
  value: string[]
  onChange: (next: string[]) => void
  readonly?: boolean
}

const PermissionField = ({
  value,
  onChange,
  readonly = false,
}: PermissionFieldProps) => {
  return (
    <div className="flex flex-col gap-2">
      <div className="system-sm-medium text-text-secondary">Permissions</div>
      <PermissionPicker value={value} onChange={onChange} readonly={readonly} />
    </div>
  )
}

export default PermissionField
