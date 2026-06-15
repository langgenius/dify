'use client'

import type { Role, RoleCategory } from '@/models/access-control'
import { cn } from '@langgenius/dify-ui/cn'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import Row from './row'

export type RoleListGroup = {
  id: string
  category: RoleCategory
  title: string
  items: Role[]
}

type RoleListProps = {
  groups: RoleListGroup[]
  className?: string
  isLoading?: boolean
  isFetchingNextPage?: boolean
  onView?: (role: Role) => void
  onEdit?: (role: Role) => void
}

const RoleList = ({
  groups,
  className,
  isLoading = false,
  isFetchingNextPage = false,
  onView,
  onEdit,
}: RoleListProps) => {
  const { t } = useTranslation()

  if (isLoading) {
    return (
      <div className={cn('px-1 py-8 text-center', className)}>
        <Loading type="app" />
      </div>
    )
  }

  return (
    <div className={cn('flex min-w-0 flex-col gap-y-6', className)}>
      {groups.map(group => (
        <section
          key={group.id}
          className="flex min-w-0 flex-col gap-y-1"
        >
          <div className="flex min-h-6 items-center system-sm-medium text-text-secondary">
            {t(`role.groups.${group.id}`, { ns: 'permission', defaultValue: group.title })}
          </div>
          <div className="flex flex-col">
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
      {isFetchingNextPage && (
        <div className="px-1 py-3 text-center">
          <Loading type="app" />
        </div>
      )}
    </div>
  )
}

export default memo(RoleList)
