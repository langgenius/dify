'use client'

import type { KnowledgeFsControlSpaceVisibility } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { Member } from '@/models/common'
import { Avatar } from '@langgenius/dify-ui/avatar'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Input } from '@langgenius/dify-ui/input'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@langgenius/dify-ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

type KnowledgeSettingsMembersProps = {
  disabled: boolean
  hasError: boolean
  members: Member[]
  ownerAccountId: string
  selectedMemberIds: string[]
  visibility: KnowledgeFsControlSpaceVisibility
  onSelectedMemberIdsChange: (memberIds: string[]) => void
  onVisibilityChange: (visibility: KnowledgeFsControlSpaceVisibility) => void
}

const VISIBILITY_OPTIONS: KnowledgeFsControlSpaceVisibility[] = [
  'only_me',
  'all_team_members',
  'partial_members',
]

export function KnowledgeSettingsMembers({
  disabled,
  hasError,
  members,
  ownerAccountId,
  selectedMemberIds,
  visibility,
  onSelectedMemberIdsChange,
  onVisibilityChange,
}: KnowledgeSettingsMembersProps) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const { t: tSettings } = useTranslation('datasetSettings')
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const selectedMembers = members.filter(
    (member) => member.id !== ownerAccountId && selectedMemberIds.includes(member.id),
  )
  const normalizedSearch = search.trim().toLocaleLowerCase()
  const filteredMembers = members.filter((member) => {
    if (!normalizedSearch) return true
    return (
      member.name.toLocaleLowerCase().includes(normalizedSearch) ||
      member.email.toLocaleLowerCase().includes(normalizedSearch)
    )
  })

  const visibilityLabel = (value: KnowledgeFsControlSpaceVisibility) => {
    if (value === 'only_me') return tSettings(($) => $['form.permissionsOnlyMe'])
    if (value === 'all_team_members') return tSettings(($) => $['form.permissionsAllMember'])
    return tSettings(($) => $['form.permissionsInvitedMembers'])
  }

  const toggleMember = (memberId: string) => {
    if (memberId === ownerAccountId) return
    if (selectedMemberIds.includes(memberId))
      onSelectedMemberIdsChange(selectedMemberIds.filter((id) => id !== memberId))
    else onSelectedMemberIdsChange([...selectedMemberIds, memberId])
  }

  return (
    <div className="min-w-0 flex-1">
      <Select
        value={visibility}
        onValueChange={(value) => {
          if (value) onVisibilityChange(value as KnowledgeFsControlSpaceVisibility)
        }}
      >
        <SelectTrigger
          aria-label={tSettings(($) => $['form.permissions'])}
          className="h-9 w-full"
          disabled={disabled}
        >
          {visibilityLabel(visibility)}
        </SelectTrigger>
        <SelectContent>
          {VISIBILITY_OPTIONS.map((option) => (
            <SelectItem key={option} value={option}>
              <SelectItemText>{visibilityLabel(option)}</SelectItemText>
              <SelectItemIndicator />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {visibility === 'partial_members' && (
        <div
          className={cn(
            'mt-3 flex min-h-6 flex-wrap items-center gap-2 rounded-lg',
            hasError && 'ring-1 ring-text-destructive',
          )}
        >
          {selectedMembers.map((member) => (
            <span
              key={member.id}
              className="inline-flex h-6 items-center gap-1 rounded-md bg-components-badge-bg-dimm px-1.5 system-xs-medium text-text-secondary"
            >
              <Avatar avatar={member.avatar_url} name={member.name} size="xxs" />
              <span className="max-w-28 truncate">{member.name}</span>
              {!disabled && (
                <button
                  type="button"
                  aria-label={`${tCommon(($) => $['operation.remove'])} ${member.name}`}
                  className="flex size-3.5 items-center justify-center rounded-sm text-text-quaternary outline-hidden hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                  onClick={() => toggleMember(member.id)}
                >
                  <span aria-hidden className="i-ri-close-line size-3" />
                </button>
              )}
            </span>
          ))}

          <Popover
            open={open}
            onOpenChange={(nextOpen) => {
              setOpen(nextOpen)
              if (!nextOpen) setSearch('')
            }}
          >
            <PopoverTrigger
              render={
                <Button
                  size="small"
                  variant="ghost"
                  disabled={disabled}
                  className="h-6 gap-1 px-1.5 text-text-tertiary"
                />
              }
            >
              <span aria-hidden className="i-ri-add-line size-3.5" />
              {tCommon(($) => $['operation.add'])}
            </PopoverTrigger>
            <PopoverContent
              placement="bottom-start"
              sideOffset={4}
              className="w-80 overflow-hidden p-0"
            >
              <PopoverTitle className="sr-only">
                {tSettings(($) => $['form.permissionsInvitedMembers'])}
              </PopoverTitle>
              <div className="border-b border-divider-subtle p-2">
                <div className="relative">
                  <span
                    aria-hidden
                    className="absolute top-1/2 left-2 i-ri-search-line size-4 -translate-y-1/2 text-text-quaternary"
                  />
                  <Input
                    aria-label={tCommon(($) => $['operation.search'])}
                    className="w-full pl-7"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
              </div>
              <div className="max-h-72 overflow-y-auto p-1">
                {filteredMembers.map((member) => {
                  const isOwner = member.id === ownerAccountId
                  const isSelected = selectedMemberIds.includes(member.id)
                  return (
                    <button
                      key={member.id}
                      type="button"
                      aria-pressed={isSelected}
                      disabled={isOwner}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-default disabled:opacity-60"
                      onClick={() => toggleMember(member.id)}
                    >
                      <Avatar avatar={member.avatar_url} name={member.name} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate system-sm-medium text-text-secondary">
                          {member.name}
                        </span>
                        <span className="block truncate system-xs-regular text-text-tertiary">
                          {member.email}
                        </span>
                      </span>
                      {isSelected && (
                        <span aria-hidden className="i-ri-check-line size-4 text-text-accent" />
                      )}
                    </button>
                  )
                })}
                {filteredMembers.length === 0 && (
                  <p className="px-3 py-6 text-center system-xs-regular whitespace-pre-wrap text-text-tertiary">
                    {t(($) => $['newKnowledge.settings.noMembersFound'])}
                  </p>
                )}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      )}

      {visibility === 'partial_members' && hasError && (
        <p className="mt-1 system-xs-regular text-text-destructive" role="alert">
          {t(($) => $['newKnowledge.settings.membersRequired'])}
        </p>
      )}
    </div>
  )
}
