'use client'

import type { Member } from '@/models/common'
import { Avatar } from '@langgenius/dify-ui/avatar'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@langgenius/dify-ui/input-group'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { useMembers } from '@/service/use-common'
import { DEFAULT_ACCESS_POLICY_ID } from './constants'

type AddAccessSubjectPopoverProps = {
  disabled?: boolean
  existingAccountIds?: string[]
  updatingAccountId: string | null
  onAddAccessSubject: (accountId: string, accessPolicyIds: string[]) => void
}

type AddAccessSubjectPopoverContentProps = {
  existingAccountIds: string[]
  updatingAccountId: string | null
  onAddAccessSubject: (accountId: string, accessPolicyIds: string[]) => void
}

function AddAccessSubjectPopoverContent({
  existingAccountIds,
  updatingAccountId,
  onAddAccessSubject,
}: AddAccessSubjectPopoverContentProps) {
  const { t } = useTranslation()
  const [searchValue, setSearchValue] = useState('')
  const { data: membersData, isLoading } = useMembers()
  const existingAccountIdSet = useMemo(() => new Set(existingAccountIds), [existingAccountIds])
  const availableMembers = useMemo(() => {
    const normalizedSearchValue = searchValue.trim().toLowerCase()

    return (membersData?.accounts ?? []).filter((member) => {
      if (!normalizedSearchValue) return true

      const name = member.name || ''
      const email = member.email || ''
      return (
        name.toLowerCase().includes(normalizedSearchValue) ||
        email.toLowerCase().includes(normalizedSearchValue)
      )
    })
  }, [membersData?.accounts, searchValue])

  const handleAddMember = useCallback(
    (member: Member) => {
      onAddAccessSubject(member.id, [DEFAULT_ACCESS_POLICY_ID])
    },
    [onAddAccessSubject],
  )

  const addLabel = t(($) => $['operation.add'], { ns: 'common' })
  const addMembersTitle = t(($) => $['accessRule.addMembersTitle'], { ns: 'permission' })
  const addedLabel = t(($) => $['operation.added'], { ns: 'common' })

  return (
    <PopoverContent
      placement="bottom-end"
      sideOffset={8}
      className="w-86 max-w-[calc(100vw-32px)] overflow-hidden bg-components-panel-bg-blur p-0 shadow-lg backdrop-blur-[5px]"
    >
      <PopoverTitle className="sr-only">{addMembersTitle}</PopoverTitle>
      <div className="p-2 pb-1">
        <InputGroup>
          <InputGroupInput
            type="search"
            aria-label={t(($) => $['operation.search'], { ns: 'common' })}
            value={searchValue}
            placeholder={t(($) => $['placeholder.search'], { ns: 'common' })}
            className="[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
            onValueChange={setSearchValue}
            autoComplete="off"
            enterKeyHint="search"
          />
          <InputGroupAddon className="ps-1.75 pe-1.25">
            <span
              className="i-ri-search-line size-4 text-components-input-text-placeholder"
              aria-hidden="true"
            />
          </InputGroupAddon>
        </InputGroup>
      </div>
      {isLoading ? (
        <div className="flex h-20 items-center justify-center p-1">
          <Loading type="app" />
        </div>
      ) : availableMembers.length === 0 ? (
        <div className="px-3 py-6 text-center system-xs-regular text-text-tertiary">
          {t(($) => $['accessRule.noAvailableMembers'], { ns: 'permission' })}
        </div>
      ) : (
        <ul className="max-h-80 overflow-y-auto p-1">
          {availableMembers.map((member) => {
            const isAdded = existingAccountIdSet.has(member.id)
            const isUpdating = updatingAccountId === member.id
            const memberName = member.name || member.email

            return (
              <li
                key={member.id}
                className={cn(
                  'flex min-h-10 items-center gap-2 rounded-lg py-1 pr-3 pl-2',
                  !isAdded && 'hover:bg-state-base-hover',
                )}
              >
                <Avatar
                  avatar={member.avatar_url ?? member.avatar ?? null}
                  name={memberName}
                  size="sm"
                  className={cn('bg-components-icon-bg-blue-solid', isAdded && 'opacity-50')}
                />
                <div className={cn('min-w-0 flex-1', isAdded && 'opacity-50')}>
                  <div className="truncate system-sm-medium text-text-secondary">{memberName}</div>
                  <div className="truncate system-xs-regular text-text-tertiary">
                    {member.email}
                  </div>
                </div>
                {isAdded ? (
                  <button
                    type="button"
                    disabled
                    className="shrink-0 cursor-not-allowed border-0 bg-transparent p-0 system-xs-regular text-text-tertiary disabled:opacity-100"
                  >
                    {addedLabel}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={updatingAccountId !== null}
                    aria-label={t(($) => $['accessRule.addMemberAria'], {
                      ns: 'permission',
                      name: memberName,
                    })}
                    className={cn(
                      'flex h-6 shrink-0 items-center rounded-md px-1 system-xs-medium text-text-accent outline-hidden',
                      'hover:bg-state-accent-hover focus-visible:bg-state-accent-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid',
                      'disabled:cursor-not-allowed disabled:text-text-disabled disabled:hover:bg-transparent',
                    )}
                    onClick={() => handleAddMember(member)}
                  >
                    {isUpdating ? (
                      <span className="i-ri-loader-2-line size-3.5 animate-spin" aria-hidden />
                    ) : (
                      `+ ${addLabel}`
                    )}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </PopoverContent>
  )
}

function AddAccessSubjectPopover({
  disabled = false,
  existingAccountIds,
  updatingAccountId,
  onAddAccessSubject,
}: AddAccessSubjectPopoverProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const isOpen = !disabled && open

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (disabled && nextOpen) return

      setOpen(nextOpen)
    },
    [disabled],
  )

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button
            variant="primary"
            size="medium"
            disabled={disabled || existingAccountIds === undefined}
            loading={!disabled && existingAccountIds === undefined}
          >
            <span className="i-ri-add-line size-3.5" aria-hidden />
            <span>{t(($) => $['operation.add'], { ns: 'common' })}</span>
          </Button>
        }
      />
      {isOpen && existingAccountIds !== undefined && (
        <AddAccessSubjectPopoverContent
          existingAccountIds={existingAccountIds}
          updatingAccountId={updatingAccountId}
          onAddAccessSubject={onAddAccessSubject}
        />
      )}
    </Popover>
  )
}

export default memo(AddAccessSubjectPopover)
