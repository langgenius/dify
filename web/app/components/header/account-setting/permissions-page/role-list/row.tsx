import type { Role, RoleType } from '.'
import { cn } from '@langgenius/dify-ui/cn'
import { memo } from 'react'
import RowMenu from './row-menu'

type RowProps = {
  className?: string
  name: string
  description: string
  roleType: RoleType
  role: Role
  onView?: (role: Role) => void
  onEdit?: (role: Role) => void
  onDelete?: (role: Role) => void
}

const Row = ({
  className,
  name,
  description,
  roleType,
  role,
  onView,
  onEdit,
  onDelete,
}: RowProps) => {
  return (
    <div
      className={cn(
        'flex items-start gap-3 py-3.5',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="system-sm-semibold text-text-secondary">
          {name}
        </div>
        <p className="mt-1 system-sm-regular text-text-tertiary">
          {description}
        </p>
      </div>
      <RowMenu
        roleType={roleType}
        role={role}
        onView={onView}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    </div>
  )
}

export default memo(Row)
