'use client'

import type { PermissionGroup } from '@/models/access-control'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { cn } from '@langgenius/dify-ui/cn'
import { ScrollArea } from '@langgenius/dify-ui/scroll-area'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

type PermissionGroupListProps = {
  groups: PermissionGroup[]
  value: string[]
  onChange: (next: string[]) => void
  className?: string
  readonly?: boolean
}

const PermissionGroupList = ({
  groups,
  value,
  onChange,
  className,
  readonly = false,
}: PermissionGroupListProps) => {
  const { t } = useTranslation()
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<Set<string> | null>(null)

  const selectedSet = useMemo(() => new Set(value), [value])

  const defaultExpandedGroupKeys = useMemo(() => {
    if (groups.length === 0) return new Set<string>()
    const firstSelectedGroup = groups.find((group) =>
      group.permissions.some((permission) => selectedSet.has(permission.key)),
    )
    return new Set([(firstSelectedGroup ?? groups[0]!).group_key])
  }, [groups, selectedSet])

  const expandedGroupKeysMerged = expandedGroupKeys ?? defaultExpandedGroupKeys

  const toggleGroupExpanded = (groupKey: string) => {
    setExpandedGroupKeys((prev) => {
      const next = new Set(prev ?? expandedGroupKeysMerged)
      if (next.has(groupKey)) next.delete(groupKey)
      else next.add(groupKey)
      return next
    })
  }

  const togglePermission = (permissionKey: string) => {
    if (readonly) return

    if (selectedSet.has(permissionKey)) onChange(value.filter((key) => key !== permissionKey))
    else onChange([...value, permissionKey])
  }

  const toggleGroupSelection = (group: PermissionGroup, selectedCount: number) => {
    if (readonly) return

    const permissionKeys = group.permissions.map((permission) => permission.key)
    if (selectedCount === permissionKeys.length) {
      const groupPermissionKeySet = new Set(permissionKeys)
      onChange(value.filter((key) => !groupPermissionKeySet.has(key)))
      return
    }

    const next = new Set(value)
    permissionKeys.forEach((key) => next.add(key))
    onChange(Array.from(next))
  }

  return (
    <div
      className={cn(
        'min-h-0 flex-1 rounded-xl border border-components-panel-border bg-components-panel-bg shadow-xs',
        className,
      )}
    >
      <ScrollArea
        className="h-full overflow-hidden rounded-xl"
        slotClassNames={{
          viewport: 'overscroll-contain',
          content: groups.length === 0 ? 'h-full' : undefined,
        }}
      >
        {groups.length === 0 ? (
          <div className="flex h-full items-center justify-center px-3 py-6 text-center system-sm-regular text-text-tertiary">
            {t(($) => $['permissionList.noPermissionsFound'], { ns: 'permission' })}
          </div>
        ) : (
          <div className="flex flex-col">
            {groups.map((group) => {
              const expanded = expandedGroupKeysMerged.has(group.group_key)
              const selectedCount = group.permissions.reduce(
                (count, permission) => count + (selectedSet.has(permission.key) ? 1 : 0),
                0,
              )
              const totalCount = group.permissions.length
              const allSelected = totalCount > 0 && selectedCount === totalCount

              return (
                <div key={group.group_key} className="border-b border-b-divider-subtle">
                  <div className="group/permission-category flex h-12 w-full items-center gap-3 px-3 hover:bg-state-base-hover">
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left system-md-medium text-text-secondary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-components-input-border-active"
                      aria-expanded={expanded}
                      onClick={() => toggleGroupExpanded(group.group_key)}
                    >
                      {group.group_name}
                    </button>
                    {!readonly && totalCount > 0 && (
                      <button
                        type="button"
                        className="shrink-0 rounded-md px-1.5 py-0.5 system-sm-medium text-text-accent opacity-0 group-hover/permission-category:opacity-100 hover:bg-state-accent-hover focus-visible:opacity-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-components-input-border-active"
                        onClick={() => toggleGroupSelection(group, selectedCount)}
                      >
                        {allSelected
                          ? t(($) => $['permissionList.clearAll'], { ns: 'permission' })
                          : t(($) => $['permissionList.selectAll'], { ns: 'permission' })}
                      </button>
                    )}
                    {selectedCount > 0 && (
                      <span className="shrink-0 rounded-md bg-util-colors-blue-blue-100 px-2 py-0.5 system-sm-medium text-text-accent">
                        {selectedCount}/{totalCount}
                      </span>
                    )}
                    <button
                      type="button"
                      className="flex h-6 w-6 shrink-0 items-center justify-center focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-components-input-border-active"
                      aria-label={
                        expanded
                          ? t(($) => $['permissionList.collapseGroup'], { ns: 'permission' })
                          : t(($) => $['permissionList.expandGroup'], { ns: 'permission' })
                      }
                      onClick={() => toggleGroupExpanded(group.group_key)}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          'i-ri-arrow-right-s-fill h-4 w-4 text-text-tertiary transition-transform',
                          expanded && 'rotate-90',
                        )}
                      />
                    </button>
                  </div>
                  {expanded && (
                    <div className="flex flex-col">
                      {group.permissions.map((permission) => {
                        const checked = selectedSet.has(permission.key)

                        return (
                          <div
                            key={permission.key}
                            className={cn(
                              'flex min-h-9 items-center gap-3 px-3 py-1.5',
                              readonly
                                ? 'cursor-default'
                                : 'cursor-pointer hover:bg-state-base-hover',
                              checked && 'bg-state-accent-hover',
                              checked && !readonly && 'hover:bg-state-accent-hover',
                            )}
                            onClick={() => togglePermission(permission.key)}
                          >
                            <Checkbox
                              checked={checked}
                              disabled={readonly}
                              className="shrink-0"
                              onCheckedChange={() => {
                                togglePermission(permission.key)
                              }}
                            />
                            <span className="min-w-0 flex-1 truncate system-md-regular text-text-secondary">
                              {permission.name}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}

export default PermissionGroupList
