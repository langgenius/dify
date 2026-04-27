'use client'

import { cn } from '@langgenius/dify-ui/cn'
import Row from './row'

export type Role = {
  id: string
  name: string
  description: string
  permissions?: string[]
}

export type RoleType = 'system' | 'custom'

export type RoleListGroup = {
  id: string
  type: RoleType
  title: string
  items: Role[]
}

export type RoleListProps = {
  groups: RoleListGroup[]
  className?: string
  onView?: (role: Role) => void
  onEdit?: (role: Role) => void
  onDelete?: (role: Role) => void
}

const RoleList = ({
  groups,
  className,
  onView,
  onEdit,
  onDelete,
}: RoleListProps) => {
  return (
    <div className={cn('flex flex-col', className)}>
      {groups.map((group, groupIndex) => (
        <section
          key={group.id}
          className={cn(groupIndex > 0 && 'mt-6')}
        >
          <h3 className="mb-2 pr-3 system-xs-medium-uppercase tracking-wide text-text-tertiary">
            {group.title}
          </h3>
          <div className="overflow-hidden">
            {group.items.map((row, rowIndex) => (
              <Row
                key={row.id}
                className={cn(
                  rowIndex > 0 && 'border-t border-divider-subtle',
                )}
                name={row.name}
                description={row.description}
                roleType={group.type}
                role={row}
                onView={onView}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

export default RoleList
