'use client'

import type { ComboboxProps } from '@langgenius/dify-ui/combobox'
import type { Ref } from 'react'
import type { Role } from '@/models/access-control'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Combobox,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxStatus,
} from '@langgenius/dify-ui/combobox'
import { DialogBody } from '@langgenius/dify-ui/dialog'
import { InputGroup, InputGroupAddon } from '@langgenius/dify-ui/input-group'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocale } from '#i18n'
import { getAccessControlTemplateLanguage } from '@/i18n/language'
import {
  createSelectedRolePlaceholder,
  workspaceRoleListInfiniteOptions,
} from './workspace-role-list-query'

type WorkspaceRolePickerProps = {
  searchInputRef?: Ref<HTMLInputElement>
  readOnly?: boolean
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

const normalizeLegacyRoleKey = (value: string) => value.trim().toLowerCase()

const isLegacyRoleKey = (value: string): value is LegacyRoleKey =>
  Object.prototype.hasOwnProperty.call(LEGACY_ROLE_DESCRIPTION_KEY_MAP, value)

const getLegacyRoleDescriptionKey = (role: Role) => {
  const candidateKeys = [normalizeLegacyRoleKey(role.name), normalizeLegacyRoleKey(role.id)]

  return candidateKeys.find(isLegacyRoleKey)
}

const WorkspaceRolePicker = ({
  searchInputRef,
  readOnly = false,
  selectedRoleIds,
  selectedRoles,
  allowMultipleRoles = true,
  disabledRoleIds = EMPTY_DISABLED_ROLE_IDS,
  onSelectedRolesChange,
  includeOwner = false,
}: WorkspaceRolePickerProps) => {
  const { t } = useTranslation(['permission', 'workspaceMembers'])
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
  } = useInfiniteQuery(
    workspaceRoleListInfiniteOptions({
      page: 1,
      limit: PAGE_SIZE,
      include_owner: includeOwner ? 1 : 0,
      language,
    }),
  )

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
  const disabledRoleIdSet = useMemo(() => new Set(disabledRoleIds), [disabledRoleIds])
  const selectedRoleObjects = useMemo(() => {
    if (selectedRoles) return selectedRoles

    return selectedRoleIds.map(
      (roleId) => roleById.get(roleId) ?? createSelectedRolePlaceholder({ id: roleId }),
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

  const statusMessage = rolesLoading
    ? t(($) => $['role.loading'], { ns: 'permission' })
    : filteredRoles.length === 0
      ? t(($) => $['role.noMatchingRoles'], { ns: 'permission' })
      : ''

  const getRoleDescription = (role: Role) => {
    if (role.description) return role.description

    const legacyRoleDescriptionKey = allowMultipleRoles
      ? undefined
      : getLegacyRoleDescriptionKey(role)

    if (legacyRoleDescriptionKey)
      return t(($) => $[LEGACY_ROLE_DESCRIPTION_KEY_MAP[legacyRoleDescriptionKey]], {
        ns: 'workspaceMembers',
      })

    return t(($) => $['role.noDescription'], { ns: 'permission' })
  }

  const renderRoleText = (role: Role) => {
    const description = getRoleDescription(role)

    return (
      <span className="min-w-0 flex-1">
        <span className="block system-sm-semibold text-text-secondary">{role.name}</span>
        <span className="mt-0.5 block system-xs-regular text-text-tertiary">{description}</span>
      </span>
    )
  }

  const comboboxProps = {
    inline: true,
    readOnly,
    open: true,
    items: roles,
    filteredItems: filteredRoles,
    filter: null,
    inputValue: keyword,
    itemToStringLabel: (role) => role.name,
    isItemEqualToValue: (item, value) => item.id === value.id,
    onInputValueChange: (value, details) => {
      // This input filters a persistent list; selecting a role must keep the query.
      if (!details.isItemPress) setKeyword(value)
    },
  } satisfies ComboboxProps<Role>

  const content = (
    <>
      <div className="shrink-0 px-6 pt-3">
        <InputGroup>
          <ComboboxInput
            ref={searchInputRef}
            className="rounded-none px-3"
            placeholder={t(($) => $['role.searchPlaceholder'], { ns: 'permission' })}
            aria-label={t(($) => $['role.searchPlaceholder'], { ns: 'permission' })}
          />
          <InputGroupAddon className="ps-1.75 pe-1.25">
            <span
              className="i-ri-search-line size-4 text-components-input-text-placeholder"
              aria-hidden
            />
          </InputGroupAddon>
        </InputGroup>
      </div>

      <DialogBody ref={containerRef} className="overscroll-contain">
        <ComboboxStatus className={cn('p-0', statusMessage && 'px-3 py-6 text-center')}>
          {statusMessage}
        </ComboboxStatus>
        <ComboboxList<Role>
          aria-label={t(($) => $['role.workspaceRoles.title'], { ns: 'permission' })}
          className="flex max-h-none flex-col gap-0.5 overflow-visible p-0"
        >
          {(role) => (
            <ComboboxItem<Role>
              key={role.id}
              value={role}
              disabled={disabledRoleIdSet.has(role.id)}
              className="group/role flex min-h-0 w-full cursor-pointer items-start gap-3 border-0 bg-transparent px-3 py-2.5 text-start hover:bg-state-base-hover data-disabled:opacity-50 data-disabled:hover:bg-transparent data-selected:bg-state-accent-hover data-selected:hover:bg-state-accent-hover data-disabled:data-selected:hover:bg-transparent data-highlighted:data-selected:bg-state-accent-hover"
            >
              <span
                aria-hidden
                className={cn(
                  'pointer-events-none mt-0.5 inline-flex size-4 shrink-0 items-center justify-center border shadow-xs shadow-shadow-shadow-3',
                  allowMultipleRoles
                    ? 'rounded-sm border-components-checkbox-border bg-components-checkbox-bg-unchecked text-components-checkbox-icon group-data-disabled/role:border-components-checkbox-border-disabled group-data-disabled/role:bg-components-checkbox-bg-disabled group-data-selected/role:border-transparent group-data-selected/role:bg-components-checkbox-bg group-data-disabled/role:group-data-selected/role:border-transparent group-data-disabled/role:group-data-selected/role:bg-components-checkbox-bg-disabled-checked group-data-disabled/role:group-data-selected/role:text-components-checkbox-icon-disabled'
                    : 'rounded-full border-components-radio-border bg-components-radio-bg group-data-disabled/role:border-components-radio-border-disabled group-data-disabled/role:bg-components-radio-bg-disabled group-data-selected/role:border-[5px] group-data-selected/role:border-components-radio-border-checked group-data-disabled/role:group-data-selected/role:border-components-radio-border-checked-disabled',
                )}
              >
                {allowMultipleRoles && (
                  <span className="i-ri-check-line hidden size-3 group-data-selected/role:block" />
                )}
              </span>
              {renderRoleText(role)}
            </ComboboxItem>
          )}
        </ComboboxList>
        <div ref={anchorRef} className="h-0" />
      </DialogBody>
    </>
  )

  return allowMultipleRoles ? (
    <Combobox<Role, true>
      {...comboboxProps}
      multiple
      value={selectedRoleObjects}
      onValueChange={onSelectedRolesChange}
    >
      {content}
    </Combobox>
  ) : (
    <Combobox<Role>
      {...comboboxProps}
      value={selectedRoleObjects[0] ?? null}
      onValueChange={(role) => {
        if (role) onSelectedRolesChange([role])
      }}
    >
      {content}
    </Combobox>
  )
}

export default WorkspaceRolePicker
