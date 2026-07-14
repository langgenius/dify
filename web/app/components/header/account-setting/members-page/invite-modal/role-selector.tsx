'use client'

import type { Role } from '@/models/access-control'
import { Field, FieldError } from '@langgenius/dify-ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@langgenius/dify-ui/select'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocale } from '@/context/i18n'
import { getAccessControlTemplateLanguage } from '@/i18n-config/language'
import { useWorkspaceRoleList } from '@/service/access-control/use-workspace-roles'

type RoleSelectorProps = {
  hasServerError?: boolean
  disabled?: boolean
}

const PAGE_SIZE = 20
const LEGACY_ROLE_DESCRIPTION_KEY_MAP = {
  admin: 'members.adminTip',
  editor: 'members.editorTip',
  normal: 'members.normalTip',
  dataset_operator: 'members.datasetOperatorTip',
} as const

type LegacyRoleKey = keyof typeof LEGACY_ROLE_DESCRIPTION_KEY_MAP

function normalizeLegacyRoleKey(value: string) {
  return value.trim().toLowerCase()
}

function isLegacyRoleKey(value: string): value is LegacyRoleKey {
  return Object.prototype.hasOwnProperty.call(LEGACY_ROLE_DESCRIPTION_KEY_MAP, value)
}

function getLegacyRoleDescriptionKey(role: Role) {
  const candidateKeys = [normalizeLegacyRoleKey(role.name), normalizeLegacyRoleKey(role.id)]
  return candidateKeys.find(isLegacyRoleKey)
}

export function RoleSelector({ hasServerError = false, disabled = false }: RoleSelectorProps) {
  const { t } = useTranslation()
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  const [observerReadyKey, setObserverReadyKey] = useState(0)
  const language = getAccessControlTemplateLanguage(locale)

  const {
    data: rolesData,
    isLoading: rolesLoading,
    error: rolesError,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useWorkspaceRoleList({
    page: 1,
    limit: PAGE_SIZE,
    language,
  })

  useEffect(() => {
    const hasMore = hasNextPage ?? true
    let observer: IntersectionObserver | undefined

    if (rolesError || !open) return

    if (anchorRef.current && listRef.current) {
      const listHeight = listRef.current.clientHeight
      const dynamicMargin = Math.max(100, Math.min(listHeight * 0.2, 200))

      observer = new IntersectionObserver(
        (entries) => {
          if (
            entries[0]!.isIntersecting &&
            !rolesLoading &&
            !isFetchingNextPage &&
            !rolesError &&
            hasMore
          )
            fetchNextPage()
        },
        {
          root: listRef.current,
          rootMargin: `${dynamicMargin}px`,
        },
      )
      observer.observe(anchorRef.current)
    }

    return () => observer?.disconnect()
  }, [
    rolesLoading,
    isFetchingNextPage,
    fetchNextPage,
    rolesError,
    hasNextPage,
    open,
    observerReadyKey,
  ])

  const roles = rolesData?.pages.flatMap((page) => page.data) ?? []

  const setListElement = useCallback((node: HTMLDivElement | null) => {
    listRef.current = node
    setObserverReadyKey((key) => key + 1)
  }, [])

  const setAnchorElement = useCallback((node: HTMLDivElement | null) => {
    anchorRef.current = node
    setObserverReadyKey((key) => key + 1)
  }, [])

  const getRoleDescription = (role: Role) => {
    if (role.description) return role.description

    switch (getLegacyRoleDescriptionKey(role)) {
      case 'admin':
        return t(($) => $['members.adminTip'], { ns: 'common' })
      case 'editor':
        return t(($) => $['members.editorTip'], { ns: 'common' })
      case 'normal':
        return t(($) => $['members.normalTip'], { ns: 'common' })
      case 'dataset_operator':
        return t(($) => $['members.datasetOperatorTip'], { ns: 'common' })
    }

    return t(($) => $['role.noDescription'], { ns: 'permission' })
  }

  return (
    <Field name="role">
      <Select<Role>
        name="role"
        required
        disabled={disabled}
        open={open}
        onOpenChange={setOpen}
        itemToStringLabel={(role) => role.name}
        itemToStringValue={(role) => role.id}
        isItemEqualToValue={(role, selectedRole) => role.id === selectedRole.id}
      >
        <SelectLabel>{t(($) => $['members.role'], { ns: 'common' })}</SelectLabel>
        <SelectTrigger>
          <SelectValue placeholder={t(($) => $['members.selectRole'], { ns: 'common' })} />
        </SelectTrigger>
        <SelectContent
          listClassName="max-h-70"
          listProps={{
            ref: setListElement,
            'aria-label': t(($) => $['members.role'], { ns: 'common' }),
          }}
        >
          {rolesLoading ? (
            <div className="px-3 py-6 text-center system-sm-regular text-text-tertiary">
              {t(($) => $.loading, { ns: 'common' })}
            </div>
          ) : rolesError ? (
            <div className="px-3 py-6 text-center system-sm-regular text-text-destructive-secondary">
              {t(($) => $['dynamicSelect.error'], { ns: 'common' })}
            </div>
          ) : roles.length === 0 ? (
            <div className="px-3 py-6 text-center system-sm-regular text-text-tertiary">
              {t(($) => $['dynamicSelect.noData'], { ns: 'common' })}
            </div>
          ) : (
            <>
              {roles.map((role) => (
                <SelectItem key={role.id} value={role} className="h-auto items-start py-2">
                  <SelectItemText className="grid gap-0.5">
                    <span className="truncate text-sm leading-5 text-text-secondary">
                      {role.name}
                    </span>
                    <span className="line-clamp-2 text-xs leading-4.5 text-text-tertiary">
                      {getRoleDescription(role)}
                    </span>
                  </SelectItemText>
                  <SelectItemIndicator className="mt-0.5" />
                </SelectItem>
              ))}
              <div ref={setAnchorElement} className="h-0" />
            </>
          )}
        </SelectContent>
      </Select>
      {hasServerError ? (
        <FieldError />
      ) : (
        <FieldError match="valueMissing">
          {t(($) => $['members.selectRole'], { ns: 'common' })}
        </FieldError>
      )}
    </Field>
  )
}
