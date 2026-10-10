'use client'

import { Avatar } from '@langgenius/dify-ui/avatar'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuEmpty,
  DropdownMenuFilterProvider,
  DropdownMenuInput,
  DropdownMenuInputGroup,
  DropdownMenuItem,
  DropdownMenuList,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useQuery } from '@tanstack/react-query'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { consoleQuery } from '@/service/console'
import { DEFAULT_ACCESS_POLICY_ID } from './constants'

type AddAccessSubjectMenuProps = {
  disabled?: boolean
  existingAccountIds?: string[]
  updatingAccountId: string | null
  onAddAccessSubject: (accountId: string, accessPolicyIds: string[]) => void
}

type AddAccessSubjectMenuContentProps = {
  existingAccountIds: string[]
  updatingAccountId: string | null
  onAddAccessSubject: (accountId: string, accessPolicyIds: string[]) => void
}

// Mounted only while the menu is open, so the member list loads on demand. A failed load has no
// retry item: closing and reopening the menu mounts this again, which loads again.
function AddAccessSubjectMenuContent({
  existingAccountIds,
  updatingAccountId,
  onAddAccessSubject,
}: AddAccessSubjectMenuContentProps) {
  const { t } = useTranslation(['common', 'permission'])
  const {
    data: membersData,
    isPending: isLoading,
    error,
  } = useQuery(consoleQuery.workspaces.current.members.get.queryOptions())
  const existingAccountIdSet = new Set(existingAccountIds)
  const members = membersData?.accounts ?? []

  const addLabel = t(($) => $['operation.add'], { ns: 'common' })
  const addedLabel = t(($) => $['operation.added'], { ns: 'common' })

  return (
    <>
      <DropdownMenuInputGroup>
        <span
          aria-hidden="true"
          className="i-ri-search-line size-4 shrink-0 text-components-input-text-placeholder"
        />
        <DropdownMenuInput
          aria-label={t(($) => $['operation.search'], { ns: 'common' })}
          placeholder={t(($) => $['placeholder.search'], { ns: 'common' })}
        />
      </DropdownMenuInputGroup>
      {error && (
        <div role="alert" className="px-3 py-2 system-sm-regular text-text-tertiary">
          {t(($) => $['api.actionFailed'], { ns: 'common' })}
        </div>
      )}
      {isLoading && <LoadingPlaceholder className="h-20 p-1" />}
      {!isLoading && !error && (
        <DropdownMenuEmpty>
          {t(($) => $['accessRule.noAvailableMembers'], { ns: 'permission' })}
        </DropdownMenuEmpty>
      )}
      {/* ARIA requires a `menu` that has no items yet because they are loading to be marked busy. */}
      <DropdownMenuList aria-busy={isLoading || undefined}>
        {members.map((member) => {
          const isAdded = existingAccountIdSet.has(member.id)
          const isUpdating = updatingAccountId === member.id
          const memberName = member.name || member.email

          return (
            <DropdownMenuItem
              key={member.id}
              // The query matches the name and email, not the row's action text.
              label={`${member.name || ''} ${member.email || ''}`}
              disabled={isAdded || updatingAccountId !== null}
              closeOnClick={false}
              // Only an added member reads as spent; a pending add blocks the others without dimming them.
              className={cn(
                'h-auto min-h-10 gap-2 py-1 pr-3 pl-2',
                isAdded ? 'data-disabled:opacity-50' : 'data-disabled:opacity-100',
              )}
              onClick={() => onAddAccessSubject(member.id, [DEFAULT_ACCESS_POLICY_ID])}
            >
              <span aria-hidden="true" className="shrink-0">
                <Avatar
                  avatar={member.avatar_url ?? member.avatar ?? null}
                  name={memberName}
                  size="sm"
                  className="bg-components-icon-bg-blue-solid"
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate system-sm-medium text-text-secondary">
                  {memberName}
                </span>
                <span className="block truncate system-xs-regular text-text-tertiary">
                  {member.email}
                </span>
              </span>
              {isAdded ? (
                <span className="shrink-0 system-xs-regular text-text-tertiary">{addedLabel}</span>
              ) : isUpdating ? (
                <span className="i-ri-loader-2-line size-3.5 shrink-0 animate-spin" aria-hidden />
              ) : (
                <span className="shrink-0 system-xs-medium text-text-accent">{`+ ${addLabel}`}</span>
              )}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuList>
    </>
  )
}

function AddAccessSubjectMenu({
  disabled = false,
  existingAccountIds,
  updatingAccountId,
  onAddAccessSubject,
}: AddAccessSubjectMenuProps) {
  const { t } = useTranslation(['common', 'permission'])
  const isLoadingExisting = existingAccountIds === undefined

  return (
    <DropdownMenuFilterProvider>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={disabled}
          render={
            <Button
              variant="primary"
              size="medium"
              disabled={disabled}
              loading={!disabled && isLoadingExisting}
            />
          }
        >
          <span className="i-ri-add-line size-3.5" aria-hidden />
          <span>{t(($) => $['operation.add'], { ns: 'common' })}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          placement="bottom-end"
          sideOffset={8}
          aria-label={t(($) => $['accessRule.addMembersTitle'], { ns: 'permission' })}
          className="w-86 max-w-[calc(100vw-32px)]"
        >
          {existingAccountIds !== undefined && (
            <AddAccessSubjectMenuContent
              existingAccountIds={existingAccountIds}
              updatingAccountId={updatingAccountId}
              onAddAccessSubject={onAddAccessSubject}
            />
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </DropdownMenuFilterProvider>
  )
}

export default memo(AddAccessSubjectMenu)
