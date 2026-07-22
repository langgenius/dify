'use client'

import { useTranslation } from 'react-i18next'
import PermissionPicker from './permission-picker'

type PermissionFieldProps = {
  value: string[]
  onChange: (next: string[]) => void
  readonly?: boolean
}

const PermissionField = ({ value, onChange, readonly = false }: PermissionFieldProps) => {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="system-sm-medium text-text-secondary">
        {t(($) => $['permissionSet.permissions'], { ns: 'permission' })}
      </div>
      <PermissionPicker value={value} onChange={onChange} readonly={readonly} />
    </div>
  )
}

export default PermissionField
