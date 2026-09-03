'use client'
import type { FC } from 'react'
import type { Recipient } from '@/app/components/workflow/nodes/human-input/types'
import type { Member } from '@/models/common'
import { Avatar } from '@langgenius/dify-ui/avatar'
import { cn } from '@langgenius/dify-ui/cn'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@langgenius/dify-ui/input-group'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

const i18nPrefix = 'nodes.humanInput'

type Props = Readonly<{
  value: Recipient[]
  searchValue: string
  onSearchChange: (value: string) => void
  list: Member[]
  onSelect: (value: string) => void
  email: string
  hideSearch?: boolean
}>

const MemberList: FC<Props> = ({
  searchValue,
  list,
  value,
  onSearchChange,
  onSelect,
  email,
  hideSearch,
}) => {
  const { t } = useTranslation()
  const searchLabel = t(($) => $['operation.search'], { ns: 'common' })

  const filteredList = useMemo(() => {
    if (!list.length) return []
    if (!searchValue) return list
    return list.filter((account) => {
      const name = account.name || ''
      const email = account.email || ''
      return (
        name.toLowerCase().includes(searchValue.toLowerCase()) ||
        email.toLowerCase().includes(searchValue.toLowerCase())
      )
    })
  }, [list, searchValue])

  if (hideSearch && filteredList.length === 0) return null

  return (
    <div className="min-w-[320px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-xs">
      {!hideSearch && (
        <div className="p-2 pb-1">
          <InputGroup>
            <InputGroupInput
              type="search"
              aria-label={searchLabel}
              autoComplete="off"
              className="[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
              placeholder={searchLabel}
              value={searchValue}
              onValueChange={onSearchChange}
            />
            <InputGroupAddon className="ps-2 pe-0.5">
              <span
                aria-hidden="true"
                className="i-ri-search-line size-4 text-components-input-text-placeholder"
              />
            </InputGroupAddon>
          </InputGroup>
        </div>
      )}
      {filteredList.length > 0 && (
        <div className="max-h-62 overflow-y-auto p-1">
          {filteredList.map((account) => {
            const isSelected = value.some((item) => item.user_id === account.id)

            return (
              <button
                type="button"
                key={account.id}
                disabled={isSelected}
                className={cn(
                  'group flex w-full cursor-pointer appearance-none items-center gap-2 rounded-lg border-none bg-transparent py-1 pr-3 pl-2 text-start outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid',
                  isSelected && 'cursor-default bg-transparent hover:bg-transparent',
                )}
                onClick={() => onSelect(account.id)}
              >
                <Avatar
                  className={cn(isSelected && 'opacity-50')}
                  avatar={account.avatar_url}
                  size="sm"
                  name={account.name}
                />
                <div className={cn('grow', isSelected && 'opacity-50')}>
                  <div className="system-sm-medium text-text-secondary">
                    {account.name}
                    {account.status === 'pending' && (
                      <span className="ml-1 system-xs-medium text-text-warning">
                        {t(($) => $['members.pending'], { ns: 'common' })}
                      </span>
                    )}
                    {email === account.email && (
                      <span className="system-xs-regular text-text-tertiary">
                        {t(($) => $['members.you'], { ns: 'common' })}
                      </span>
                    )}
                  </div>
                  <div className="system-xs-regular text-text-tertiary">{account.email}</div>
                </div>
                {!isSelected && (
                  <div className="hidden system-xs-medium text-text-accent group-hover:block">
                    {t(($) => $[`${i18nPrefix}.deliveryMethod.emailConfigure.memberSelector.add`], {
                      ns: 'workflow',
                    })}
                  </div>
                )}
                {isSelected && (
                  <div className="system-xs-regular text-text-tertiary">
                    {t(
                      ($) => $[`${i18nPrefix}.deliveryMethod.emailConfigure.memberSelector.added`],
                      { ns: 'workflow' },
                    )}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default MemberList
