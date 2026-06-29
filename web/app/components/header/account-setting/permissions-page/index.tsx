'use client'

import type { RoleModalMode, submitRoleData } from './role-modal'
import type { Role } from '@/models/access-control'
import { Button } from '@langgenius/dify-ui/button'
import { toast } from '@langgenius/dify-ui/toast'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from '#i18n'
import { useSelector as useAppContextWithSelector } from '@/context/app-context'
import { useLocale } from '@/context/i18n'
import { getAccessControlTemplateLanguage } from '@/i18n-config/language'
import { useCreateWorkspaceRole, useUpdateWorkspaceRole } from '@/service/access-control/use-workspace-roles'
import { hasPermission } from '@/utils/permission'
import { useRoleGroups } from './hooks'
import RoleList from './role-list'
import RoleModal from './role-modal'

type PermissionsPageProps = {
  containerRef: React.RefObject<HTMLDivElement | null>
}

type ModalState = {
  mode: RoleModalMode
  role?: Role
} | null

const PAGE_SIZE = 20

const PermissionsPage = ({ containerRef }: PermissionsPageProps) => {
  const { t } = useTranslation()
  const locale = useLocale()
  const [modalState, setModalState] = useState<ModalState>(null)
  const anchorRef = useRef<HTMLDivElement>(null)

  const workspacePermissionKeys = useAppContextWithSelector(s => s.workspacePermissionKeys)

  const language = useMemo(() => getAccessControlTemplateLanguage(locale), [locale])

  const {
    roleGroups,
    isLoading,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
    error,
  } = useRoleGroups({
    page: 1,
    limit: PAGE_SIZE,
    include_owner: 1,
    language,
  })

  const { mutateAsync: createWorkspaceRole } = useCreateWorkspaceRole()
  const { mutateAsync: updateWorkspaceRole } = useUpdateWorkspaceRole()

  const openCreate = useCallback(() => {
    setModalState({ mode: 'create' })
  }, [])

  const handleView = useCallback((role: Role) => {
    setModalState({ mode: 'view', role })
  }, [])

  const handleEdit = useCallback((role: Role) => {
    setModalState({ mode: 'edit', role })
  }, [])

  const closeModal = useCallback(() => setModalState(null), [])

  const handleSubmit = useCallback(
    (data: submitRoleData) => {
      const { name, description, permissionKeys } = data
      const mode = modalState?.mode ?? ''
      const roleId = modalState?.role?.id ?? ''
      if (mode === 'create') {
        createWorkspaceRole({ name, description, permission_keys: permissionKeys }, {
          onSuccess: () => {
            toast.success(t('role.created', { ns: 'permission' }))
            closeModal()
          },
        })
      }
      else if (mode === 'edit') {
        updateWorkspaceRole({ id: roleId, name, description, permission_keys: permissionKeys }, {
          onSuccess: () => {
            toast.success(t('role.updated', { ns: 'permission' }))
            closeModal()
          },
        })
      }
    },
    [createWorkspaceRole, updateWorkspaceRole, closeModal, modalState, t],
  )

  useEffect(() => {
    const hasMore = hasNextPage ?? true
    let observer: IntersectionObserver | undefined

    if (error) {
      if (observer)
        observer.disconnect()
      return
    }

    if (anchorRef.current && containerRef.current) {
      const containerHeight = containerRef.current.clientHeight
      const dynamicMargin = Math.max(100, Math.min(containerHeight * 0.2, 200))

      observer = new IntersectionObserver((entries) => {
        if (entries[0]!.isIntersecting && !isLoading && !isFetchingNextPage && !error && hasMore)
          fetchNextPage()
      }, {
        root: containerRef.current,
        rootMargin: `${dynamicMargin}px`,
      })
      observer.observe(anchorRef.current)
    }
    return () => observer?.disconnect()
  }, [isLoading, isFetchingNextPage, fetchNextPage, error, hasNextPage, containerRef])

  const canManageRoles = hasPermission(workspacePermissionKeys, 'workspace.role.manage')

  return (
    <>
      <div className="flex min-w-0 flex-col gap-y-6">
        <div className="flex min-h-[67px] min-w-0 items-center gap-3 overflow-hidden rounded-xl border-t-[0.5px] border-l-[0.5px] border-divider-regular bg-linear-to-b from-background-gradient-bg-fill-chat-bg-2 to-background-gradient-bg-fill-chat-bg-1 px-4 py-3">
          <div className="flex min-w-0 grow flex-col gap-y-1 overflow-hidden">
            <div className="truncate system-md-semibold text-text-secondary">
              {t('role.workspaceRoles.title', { ns: 'permission' })}
            </div>
            <div className="truncate system-xs-regular text-text-tertiary">
              {t('role.workspaceRoles.description', { ns: 'permission' })}
            </div>
          </div>
          {canManageRoles && (
            <div className="flex shrink-0 items-center">
              <Button
                variant="primary"
                size="small"
                onClick={openCreate}
                disabled={isLoading}
              >
                {t('role.addRole', { ns: 'permission' })}
              </Button>
            </div>
          )}
        </div>
        <RoleList
          groups={roleGroups}
          isLoading={isLoading}
          isFetchingNextPage={isFetchingNextPage}
          onView={handleView}
          onEdit={handleEdit}
        />
        <div ref={anchorRef} className="h-0" />
      </div>
      {modalState && (
        <RoleModal
          mode={modalState?.mode ?? 'create'}
          open
          role={modalState?.role}
          onClose={closeModal}
          onSubmit={handleSubmit}
        />
      )}
    </>
  )
}

export default PermissionsPage
