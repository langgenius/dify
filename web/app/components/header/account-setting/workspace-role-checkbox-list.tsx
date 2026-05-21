'use client'

import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { cn } from '@langgenius/dify-ui/cn'
import { ScrollArea } from '@langgenius/dify-ui/scroll-area'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import { useWorkspaceRoleList } from '@/service/access-control/use-workspace-roles'

type WorkspaceRoleCheckboxListProps = {
  selectedRoleIds: string[]
  onSelectedRoleIdsChange: (selectedRoleIds: string[]) => void
}

const PAGE_SIZE = 20

const WorkspaceRoleCheckboxList = ({
  selectedRoleIds,
  onSelectedRoleIdsChange,
}: WorkspaceRoleCheckboxListProps) => {
  const { t } = useTranslation()
  const [keyword, setKeyword] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<HTMLDivElement>(null)

  const {
    data: rolesData,
    isLoading: rolesLoading,
    error,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useWorkspaceRoleList({
    page: 1,
    limit: PAGE_SIZE,
  })

  useEffect(() => {
    const hasMore = hasNextPage ?? true
    let observer: IntersectionObserver | undefined

    if (error)
      return

    if (anchorRef.current && containerRef.current) {
      const containerHeight = containerRef.current.clientHeight
      const dynamicMargin = Math.max(100, Math.min(containerHeight * 0.2, 200))

      observer = new IntersectionObserver((entries) => {
        if (entries[0]!.isIntersecting && !rolesLoading && !isFetchingNextPage && !error && hasMore)
          fetchNextPage()
      }, {
        root: containerRef.current,
        rootMargin: `${dynamicMargin}px`,
      })
      observer.observe(anchorRef.current)
    }
    return () => observer?.disconnect()
  }, [rolesLoading, isFetchingNextPage, fetchNextPage, error, hasNextPage])

  const roles = useMemo(() => rolesData?.pages.flatMap(page => page.data) ?? [], [rolesData])

  const filteredRoles = useMemo(() => {
    const trimmed = keyword.trim().toLowerCase()
    if (!trimmed)
      return roles

    return roles.filter(
      role =>
        role.name.toLowerCase().includes(trimmed)
        || role.description?.toLowerCase().includes(trimmed),
    )
  }, [roles, keyword])

  const toggleRole = (id: string) => {
    onSelectedRoleIdsChange(
      selectedRoleIds.includes(id)
        ? selectedRoleIds.filter(selectedId => selectedId !== id)
        : [...selectedRoleIds, id],
    )
  }

  return (
    <>
      <div className="shrink-0 px-6 pt-3 pb-2">
        <Input
          showLeftIcon
          showClearIcon
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          onClear={() => setKeyword('')}
          placeholder={t('role.searchPlaceholder', { ns: 'permission' })}
        />
      </div>

      <ScrollArea
        ref={containerRef}
        className="min-h-0 flex-1"
        slotClassNames={{ viewport: 'px-3 overscroll-contain' }}
      >
        {rolesLoading
          ? (
              <div className="px-3 py-6 text-center system-sm-regular text-text-tertiary">
                {t('role.loading', { ns: 'permission' })}
              </div>
            )
          : filteredRoles.length === 0
            ? (
                <div className="px-3 py-6 text-center system-sm-regular text-text-tertiary">
                  {t('role.noMatchingRoles', { ns: 'permission' })}
                </div>
              )
            : (
                <>
                  <ul className="flex flex-col gap-0.5 pb-2">
                    {filteredRoles.map((role) => {
                      const checked = selectedRoleIds.includes(role.id)
                      const handleToggle = () => toggleRole(role.id)

                      return (
                        <li key={role.id}>
                          <div
                            role="checkbox"
                            aria-checked={checked}
                            tabIndex={0}
                            className={cn(
                              'flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2.5 hover:bg-state-base-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-components-input-border-active',
                              checked && 'bg-state-accent-hover hover:bg-state-accent-hover',
                            )}
                            onClick={handleToggle}
                            onKeyDown={(e) => {
                              if (e.key === ' ' || e.key === 'Enter') {
                                e.preventDefault()
                                handleToggle()
                              }
                            }}
                          >
                            <Checkbox
                              checked={checked}
                              className="pointer-events-none mt-0.5"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="system-sm-semibold text-text-secondary">
                                {role.name}
                              </div>
                              <div className="mt-0.5 system-xs-regular text-text-tertiary">
                                {role.description || t('role.noDescription', { ns: 'permission' })}
                              </div>
                            </div>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                  <div ref={anchorRef} className="h-0" />
                </>
              )}
      </ScrollArea>
    </>
  )
}

export default WorkspaceRoleCheckboxList
