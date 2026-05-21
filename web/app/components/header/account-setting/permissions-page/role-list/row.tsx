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

const Row = ({
  className,
  name,
  description,
  roleCategory,
  role,
  onView,
  onEdit,
}: RowProps) => {
  const { t } = useTranslation()

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
          {description || t('role.noDescription', { ns: 'permission' })}
        </p>
      </div>
      <RowMenu
        roleCategory={roleCategory}
        role={role}
        onView={onView}
        onEdit={onEdit}
      />
    </div>
  )
}

export default memo(Row)
