import type { Role, RoleCategory } from '@/models/access-control'
import { cn } from '@langgenius/dify-ui/cn'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import RowMenu from './row-menu'

type RowProps = {
  className?: string
  name: string
  description: string
  roleCategory: RoleCategory
  role: Role
  onView?: (role: Role) => void
  onEdit?: (role: Role) => void
}

const Row = ({ className, name, description, roleCategory, role, onView, onEdit }: RowProps) => {
  const { t } = useTranslation()

  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-3 border-b border-divider-regular px-3 py-3.5 hover:bg-background-default-hover',
        className,
      )}
    >
      <div className="min-w-0 flex-1 space-y-1">
        <div className="truncate system-sm-semibold text-text-primary">{name}</div>
        <p className="truncate system-xs-regular text-text-secondary">
          {description || t(($) => $['role.noDescription'], { ns: 'permission' })}
        </p>
      </div>
      <RowMenu roleCategory={roleCategory} role={role} onView={onView} onEdit={onEdit} />
    </div>
  )
}

export default memo(Row)
