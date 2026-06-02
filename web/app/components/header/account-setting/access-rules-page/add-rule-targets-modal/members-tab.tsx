'use client'

import type { Member } from '@/models/common'
import { Avatar } from '@langgenius/dify-ui/avatar'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { cn } from '@langgenius/dify-ui/cn'
import { Input } from '@langgenius/dify-ui/input'
import { ScrollArea } from '@langgenius/dify-ui/scroll-area'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMembers } from '@/service/use-common'

type AssignableMemberOption = {
  id: string
  name: string
  email: string
  avatarUrl?: string | null
}

type MembersTabProps = {
  selectedMemberIds: string[]
  disabledMemberIds?: string[]
  onSelectedMemberIdsChange: (selectedMemberIds: string[]) => void
}

const toMemberOption = (member: Member): AssignableMemberOption => ({
  id: member.id,
  name: member.name,
  email: member.email,
  avatarUrl: member.avatar_url ?? member.avatar ?? null,
})

const MembersTab = ({
  selectedMemberIds,
  disabledMemberIds = [],
  onSelectedMemberIdsChange,
}: MembersTabProps) => {
  const { t } = useTranslation()
  const [keyword, setKeyword] = useState('')

  const { data: membersData, isLoading: membersLoading } = useMembers()

  const members = useMemo<AssignableMemberOption[]>(() => {
    const accounts = membersData?.accounts ?? []
    return accounts
      .filter(account => account.status !== 'banned' && account.status !== 'closed')
      .map(toMemberOption)
  }, [membersData])

  const filteredMembers = useMemo(() => {
    const trimmed = keyword.trim().toLowerCase()
    if (!trimmed)
      return members

    return members.filter(
      member =>
        member.name.toLowerCase().includes(trimmed)
        || member.email.toLowerCase().includes(trimmed),
    )
  }, [members, keyword])

  const toggleMember = (id: string) => {
    if (disabledMemberIds.includes(id))
      return

    onSelectedMemberIdsChange(
      selectedMemberIds.includes(id)
        ? selectedMemberIds.filter(selectedId => selectedId !== id)
        : [...selectedMemberIds, id],
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
            onChange={e => setKeyword(e.target.value)}
            placeholder={t('addRuleTargets.searchMembers', { ns: 'permission' })}
            className="pr-8 pl-8"
          />
          {keyword && (
            <button
              type="button"
              className="absolute top-1/2 right-2 flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-components-input-border-active"
              aria-label={t('operation.clear', { ns: 'common' })}
              onClick={() => setKeyword('')}
            >
              <span aria-hidden className="i-ri-close-line size-4" />
            </button>
          )}
        </div>
      </div>

      <ScrollArea
        className="min-h-0 flex-1"
        slotClassNames={{ viewport: 'px-3 overscroll-contain' }}
      >
        {membersLoading
          ? (
              <div className="px-3 py-6 text-center system-sm-regular text-text-tertiary">
                {t('addRuleTargets.loadingMembers', { ns: 'permission' })}
              </div>
            )
          : filteredMembers.length === 0
            ? (
                <div className="px-3 py-6 text-center system-sm-regular text-text-tertiary">
                  {t('addRuleTargets.noMatchingMembers', { ns: 'permission' })}
                </div>
              )
            : (
                <ul className="flex flex-col gap-0.5 pb-2">
                  {filteredMembers.map((member) => {
                    const checked = selectedMemberIds.includes(member.id)
                    const disabled = disabledMemberIds.includes(member.id)
                    const handleToggle = () => toggleMember(member.id)

                    return (
                      <li key={member.id}>
                        <div
                          role="checkbox"
                          aria-checked={checked}
                          aria-disabled={disabled}
                          tabIndex={disabled ? -1 : 0}
                          className={cn(
                            'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-state-base-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-components-input-border-active',
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
                            className="pointer-events-none"
                          />
                          <Avatar
                            avatar={member.avatarUrl ?? null}
                            name={member.name}
                            size="md"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="system-sm-semibold text-text-secondary">
                              {member.name}
                            </div>
                            <div className="mt-0.5 truncate system-xs-regular text-text-tertiary">
                              {member.email}
                            </div>
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
      </ScrollArea>
    </>
  )
}

export default MembersTab
