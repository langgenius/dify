import type { Role } from '@/models/access-control'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { ScrollArea } from '@langgenius/dify-ui/scroll-area'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocale } from '@/context/i18n'
import { getAccessControlTemplateLanguage } from '@/i18n-config/language'
import { useWorkspaceRoleList } from '@/service/access-control/use-workspace-roles'

type RoleSelectorProps = {
  value: string
  onChange: (role: string) => void
}

const PAGE_SIZE = 20
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
  const candidateKeys = [
    normalizeLegacyRoleKey(role.name),
    normalizeLegacyRoleKey(role.id),
  ]

  return candidateKeys.find(isLegacyRoleKey)
}

const RoleSelector = ({ value, onChange }: RoleSelectorProps) => {
  const { t } = useTranslation()
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  const [observerReadyKey, setObserverReadyKey] = useState(0)
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
    language,
  })

  useEffect(() => {
    const hasMore = hasNextPage ?? true
    let observer: IntersectionObserver | undefined

    if (error || !open)
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
  }, [rolesLoading, isFetchingNextPage, fetchNextPage, error, hasNextPage, open, observerReadyKey])

  const roles = useMemo(() => rolesData?.pages.flatMap(page => page.data) ?? [], [rolesData])
  const selectedRole = roles.find(role => role.id === value)
  const selectedRoleName = selectedRole?.name || value
  const triggerLabel = selectedRoleName
    ? t('members.invitedAsRole', { ns: 'common', role: selectedRoleName })
    : t('members.selectRole', { ns: 'common' })

  const setContainerElement = useCallback((node: HTMLDivElement | null) => {
    containerRef.current = node
    setObserverReadyKey(key => key + 1)
  }, [])

  const setAnchorElement = useCallback((node: HTMLDivElement | null) => {
    anchorRef.current = node
    setObserverReadyKey(key => key + 1)
  }, [])

  const handleRoleChange = (roleId: string) => {
    onChange(roleId)
    setOpen(false)
  }

  const getRoleDescription = (role: Role) => {
    if (role.description)
      return role.description

    const legacyRoleDescriptionKey = getLegacyRoleDescriptionKey(role)

    switch (legacyRoleDescriptionKey) {
      case 'admin':
        return t('members.adminTip', { ns: 'common' })
      case 'editor':
        return t('members.editorTip', { ns: 'common' })
      case 'normal':
        return t('members.normalTip', { ns: 'common' })
      case 'dataset_operator':
        return t('members.datasetOperatorTip', { ns: 'common' })
    }

    return t('role.noDescription', { ns: 'permission' })
  }

  return (
    <DropdownMenu
      open={open}
      onOpenChange={setOpen}
      modal={false}
    >
      <DropdownMenuTrigger
        data-testid="role-selector-trigger"
        className={cn(
          'flex w-full cursor-pointer items-center rounded-lg bg-components-input-bg-normal px-3 py-2 hover:bg-state-base-hover',
          open && 'bg-state-base-hover',
        )}
      >
        <div className="mr-2 grow text-sm/5 text-text-primary">{triggerLabel}</div>
        <div className={cn('size-4 shrink-0 text-text-secondary', open ? 'i-ri-arrow-up-s-line' : 'i-ri-arrow-down-s-line')} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        placement="bottom-start"
        sideOffset={4}
        popupClassName="w-[336px] rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg p-0 shadow-lg"
      >
        <ScrollArea
          ref={setContainerElement}
          className="h-70"
          slotClassNames={{ viewport: 'overscroll-contain' }}
        >
          <div className="p-1">
            {rolesLoading
              ? (
                  <div className="px-3 py-6 text-center system-sm-regular text-text-tertiary">
                    {t('loading', { ns: 'common' })}
                  </div>
                )
              : roles.length === 0
                ? (
                    <div className="px-3 py-6 text-center system-sm-regular text-text-tertiary">
                      {t('dynamicSelect.noData', { ns: 'common' })}
                    </div>
                  )
                : (
                    <>
                      <DropdownMenuRadioGroup
                        value={value}
                        onValueChange={handleRoleChange}
                      >
                        {roles.map(role => (
                          <DropdownMenuRadioItem
                            key={role.id}
                            value={role.id}
                            className="mx-0 h-auto w-full cursor-pointer items-start gap-0 rounded-lg border-none bg-transparent p-2 text-left hover:bg-state-base-hover data-highlighted:bg-state-base-hover"
                          >
                            <div className="relative min-w-0 pl-5">
                              <div className="truncate text-sm leading-5 text-text-secondary">{role.name}</div>
                              <div className="line-clamp-2 text-xs leading-4.5 text-text-tertiary">{getRoleDescription(role)}</div>
                              {value === role.id && (
                                <div
                                  aria-hidden="true"
                                  className="absolute top-0.5 left-0 i-custom-vender-line-general-check h-4 w-4 text-text-accent"
                                />
                              )}
                            </div>
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                      <div ref={setAnchorElement} className="h-0" />
                    </>
                  )}
          </div>
        </ScrollArea>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default RoleSelector
