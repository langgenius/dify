'use client'

import type { Role, RoleCategory } from '@/models/access-control'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import Row from './row'

export type RoleListGroup = {
  id: string
  category: RoleCategory
  title: string
  items: Role[]
}

export type RoleListProps = {
  groups: RoleListGroup[]
  className?: string
  onView?: (role: Role) => void
  onEdit?: (role: Role) => void
}

const RoleList = ({
  groups,
  className,
  onView,
  onEdit,
}: RoleListProps) => {
  const { t } = useTranslation()

  return (
    <div className={cn('flex flex-col gap-y-6', className)}>
      {groups.map(group => (
        <section
          key={group.id}
          className="flex flex-col gap-y-1"
        >
          <div className="flex h-6 items-center system-sm-medium text-text-secondary">
            {t(`role.groups.${group.id}`, { ns: 'permission', defaultValue: group.title })}
          </div>
          <div className="flex flex-col gap-2">
            {group.items.map(row => (
              <Row
                key={row.id}
                name={row.name}
                description={row.description}
                roleCategory={group.category}
                role={row}
                onView={onView}
                onEdit={onEdit}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

export default RoleList
