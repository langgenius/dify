'use client'

import type { Role } from '@/models/access-control'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { cn } from '@langgenius/dify-ui/cn'
import { Input } from '@langgenius/dify-ui/input'
import { RadioControl, RadioGroup, RadioItem } from '@langgenius/dify-ui/radio'
import { ScrollArea } from '@langgenius/dify-ui/scroll-area'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocale } from '@/context/i18n'
import { getAccessControlTemplateLanguage } from '@/i18n-config/language'
import { useWorkspaceRoleList } from '@/service/access-control/use-workspace-roles'

type WorkspaceRoleCheckboxListProps = {
  selectedRoleIds: string[]
  selectedRoles?: Role[]
  allowMultipleRoles?: boolean
  disabledRoleIds?: string[]
  onSelectedRolesChange: (selectedRoles: Role[]) => void
  includeOwner?: boolean
}

const PAGE_SIZE = 20
const EMPTY_DISABLED_ROLE_IDS: string[] = []
const LEGACY_ROLE_DESCRIPTION_KEY_MAP = {
  admin: 'members.adminTip',
  editor: 'members.editorTip',
  normal: 'members.normalTip',
  dataset_operator: 'members.datasetOperatorTip',
} as const

type LegacyRoleKey = keyof typeof LEGACY_ROLE_DESCRIPTION_KEY_MAP

const createSelectedRolePlaceholder = (id: string): Role => ({
  id,
  tenant_id: '',
  type: 'workspace',
  category: 'global_custom',
  name: id,
  description: '',
  is_builtin: false,
  permission_keys: [],
  role_tag: '',
})

const normalizeLegacyRoleKey = (value: string) => value.trim().toLowerCase()

const isLegacyRoleKey = (value: string): value is LegacyRoleKey =>
  Object.prototype.hasOwnProperty.call(LEGACY_ROLE_DESCRIPTION_KEY_MAP, value)

const getLegacyRoleDescriptionKey = (role: Role) => {
  const candidateKeys = [normalizeLegacyRoleKey(role.name), normalizeLegacyRoleKey(role.id)]

  return candidateKeys.find(isLegacyRoleKey)
}

const WorkspaceRoleCheckboxList = ({
  selectedRoleIds,
  selectedRoles,
  allowMultipleRoles = true,
  disabledRoleIds = EMPTY_DISABLED_ROLE_IDS,
  onSelectedRolesChange,
  includeOwner = false,
}: WorkspaceRoleCheckboxListProps) => {
  const { t } = useTranslation()
  const locale = useLocale()
  const [keyword, setKeyword] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  const language = useMemo(() => getAccessControlTemplateLanguage(locale), [locale])

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
    include_owner: includeOwner ? 1 : 0,
    language,
  })

  useEffect(() => {
    const hasMore = hasNextPage ?? true
    let observer: IntersectionObserver | undefined

    if (error) return

    if (anchorRef.current && containerRef.current) {
      const containerHeight = containerRef.current.clientHeight
      const dynamicMargin = Math.max(100, Math.min(containerHeight * 0.2, 200))

      observer = new IntersectionObserver(
        (entries) => {
          if (
            entries[0]!.isIntersecting &&
            !rolesLoading &&
            !isFetchingNextPage &&
            !error &&
            hasMore
          )
            fetchNextPage()
        },
        {
          root: containerRef.current,
          rootMargin: `${dynamicMargin}px`,
        },
      )
      observer.observe(anchorRef.current)
    }
    return () => observer?.disconnect()
  }, [rolesLoading, isFetchingNextPage, fetchNextPage, error, hasNextPage])

  const roles = useMemo(() => rolesData?.pages.flatMap((page) => page.data) ?? [], [rolesData])
  const roleById = useMemo(() => {
    return new Map(roles.map((role) => [role.id, role]))
  }, [roles])
  const selectedRoleIdSet = useMemo(() => new Set(selectedRoleIds), [selectedRoleIds])
  const disabledRoleIdSet = useMemo(() => new Set(disabledRoleIds), [disabledRoleIds])
  const selectedRoleObjects = useMemo(() => {
    if (selectedRoles) return selectedRoles

    return selectedRoleIds.map(
      (roleId) => roleById.get(roleId) ?? createSelectedRolePlaceholder(roleId),
    )
  }, [roleById, selectedRoleIds, selectedRoles])

  const filteredRoles = useMemo(() => {
    const trimmed = keyword.trim().toLowerCase()
    if (!trimmed) return roles

    return roles.filter(
      (role) =>
        role.name.toLowerCase().includes(trimmed) ||
        role.description?.toLowerCase().includes(trimmed),
    )
  }, [roles, keyword])

  const toggleRole = useCallback(
    (role: Role) => {
      if (disabledRoleIdSet.has(role.id)) return

      if (!allowMultipleRoles) {
        onSelectedRolesChange(selectedRoleIdSet.has(role.id) ? selectedRoleObjects : [role])
        return
      }

      onSelectedRolesChange(
        selectedRoleIdSet.has(role.id)
          ? selectedRoleObjects.filter((selectedRole) => selectedRole.id !== role.id)
          : [...selectedRoleObjects, role],
      )
    },
    [
      allowMultipleRoles,
      disabledRoleIdSet,
      onSelectedRolesChange,
      selectedRoleIdSet,
      selectedRoleObjects,
    ],
  )

  const handleRadioValueChange = useCallback(
    (roleId: string) => {
      const role = roleById.get(roleId)
      if (!role || disabledRoleIdSet.has(role.id)) return

      onSelectedRolesChange([role])
    },
    [disabledRoleIdSet, onSelectedRolesChange, roleById],
  )

  const getRoleDescription = (role: Role) => {
    if (role.description) return role.description

    const legacyRoleDescriptionKey = allowMultipleRoles
      ? undefined
      : getLegacyRoleDescriptionKey(role)

    if (legacyRoleDescriptionKey)
      return t(($) => $[LEGACY_ROLE_DESCRIPTION_KEY_MAP[legacyRoleDescriptionKey]], {
        ns: 'common',
      })

    return t(($) => $['role.noDescription'], { ns: 'permission' })
  }

  const renderRoleText = (role: Role) => {
    const description = getRoleDescription(role)

    return (
      <div className="min-w-0 flex-1">
        <div className="system-sm-semibold text-text-secondary">{role.name}</div>
        <div className="mt-0.5 system-xs-regular text-text-tertiary">{description}</div>
      </div>
    )
  }

  return (
    <>
      <div className="shrink-0 px-6 pt-3 pb-2">
        <div className="relative">
          <span
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 i-ri-search-line size-4 -translate-y-1/2 text-text-tertiary"
          />
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder={t(($) => $['role.searchPlaceholder'], { ns: 'permission' })}
            className="pr-8 pl-8"
          />
          {keyword && (
            <button
              type="button"
              className="absolute top-1/2 right-2 flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-components-input-border-active"
              aria-label={t(($) => $['operation.clear'], { ns: 'common' })}
              onClick={() => setKeyword('')}
            >
              <span aria-hidden className="i-ri-close-line size-4" />
            </button>
          )}
        </div>
      </div>

      <ScrollArea
        ref={containerRef}
        className="min-h-0 flex-1"
        slotClassNames={{ viewport: 'px-3 overscroll-contain' }}
      >
        {rolesLoading ? (
          <div className="px-3 py-6 text-center system-sm-regular text-text-tertiary">
            {t(($) => $['role.loading'], { ns: 'permission' })}
          </div>
        ) : filteredRoles.length === 0 ? (
          <div className="px-3 py-6 text-center system-sm-regular text-text-tertiary">
            {t(($) => $['role.noMatchingRoles'], { ns: 'permission' })}
          </div>
        ) : (
          <>
            {allowMultipleRoles ? (
              <ul className="flex flex-col gap-0.5 pb-2">
                {filteredRoles.map((role) => {
                  const checked = selectedRoleIdSet.has(role.id)
                  const disabled = disabledRoleIdSet.has(role.id)
                  const handleToggle = () => toggleRole(role)

                  return (
                    <li key={role.id}>
                      <div
                        role="checkbox"
                        aria-checked={checked}
                        aria-disabled={disabled}
                        tabIndex={disabled ? -1 : 0}
                        className={cn(
                          'flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2.5 hover:bg-state-base-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-components-input-border-active',
                          checked && 'bg-state-accent-hover hover:bg-state-accent-hover',
                          disabled && 'cursor-not-allowed opacity-50 hover:bg-transparent',
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
                          disabled={disabled}
                          className="pointer-events-none mt-0.5"
                        />
                        {renderRoleText(role)}
                      </div>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <RadioGroup
                value={selectedRoleIds[0] ?? ''}
                onValueChange={handleRadioValueChange}
                className="flex-col items-stretch gap-0.5 pb-2"
                render={<ul />}
              >
                {filteredRoles.map((role) => {
                  const checked = selectedRoleIdSet.has(role.id)
                  const disabled = disabledRoleIdSet.has(role.id)

                  return (
                    <li key={role.id}>
                      <RadioItem
                        value={role.id}
                        disabled={disabled}
                        nativeButton
                        render={
                          <button
                            type="button"
                            className={cn(
                              'flex w-full cursor-pointer items-start gap-3 rounded-lg border-0 bg-transparent px-3 py-2.5 text-left hover:bg-state-base-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-components-input-border-active',
                              checked && 'bg-state-accent-hover hover:bg-state-accent-hover',
                              disabled && 'cursor-not-allowed opacity-50 hover:bg-transparent',
                            )}
                          />
                        }
                      >
                        <RadioControl className="pointer-events-none mt-0.5" />
                        {renderRoleText(role)}
                      </RadioItem>
                    </li>
                  )
                })}
              </RadioGroup>
            )}
            <div ref={anchorRef} className="h-0" />
          </>
        )}
      </ScrollArea>
    </>
  )
}

export default WorkspaceRoleCheckboxList
