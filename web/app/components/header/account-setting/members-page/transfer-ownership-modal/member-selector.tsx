'use client'
import type { FC } from 'react'
import { Avatar } from '@langgenius/dify-ui/avatar'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import * as React from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import { useMembers } from '@/service/use-common'

type Props = {
  value?: string
  onSelect: (value: string) => void
  exclude?: string[]
}

const MemberSelector: FC<Props> = ({
  value,
  onSelect,
  exclude = [],
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')

  const { data } = useMembers()

  const currentValue = useMemo(() => {
    if (!data?.accounts || !value)
      return null
    return data.accounts.find(account => account.id === value) ?? null
  }, [data, value])

  const filteredList = useMemo(() => {
    if (!data?.accounts)
      return []
    const accounts = data.accounts
    if (!searchValue)
      return accounts.filter(account => !exclude.includes(account.id))
    return accounts.filter((account) => {
      const name = account.name || ''
      const email = account.email || ''
      return name.toLowerCase().includes(searchValue.toLowerCase())
        || email.toLowerCase().includes(searchValue.toLowerCase())
    }).filter(account => !exclude.includes(account.id))
  }, [data, exclude, searchValue])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={(
          <div
            data-testid="member-selector-trigger"
            className={cn('group flex cursor-pointer items-center gap-1.5 rounded-lg bg-components-input-bg-normal px-2 py-1 hover:bg-state-base-hover-alt', open && 'bg-state-base-hover-alt')}
          >
            {!currentValue && (
              <div className="grow p-1 system-sm-regular text-components-input-text-placeholder">{t('members.transferModal.transferPlaceholder', { ns: 'common' })}</div>
            )}
            {currentValue && (
              <>
                <Avatar avatar={currentValue.avatar_url} size="sm" name={currentValue.name} />
                <div className="grow truncate system-sm-medium text-text-secondary">{currentValue.name}</div>
                <div className="system-xs-regular text-text-quaternary">{currentValue.email}</div>
              </>
            )}
            <div className={cn('i-ri-arrow-down-s-line h-4 w-4 text-text-quaternary group-hover:text-text-secondary', open && 'text-text-secondary')} />
          </div>
        )}
      />
      <PopoverContent
        placement="bottom"
        sideOffset={4}
        popupClassName="border-none bg-transparent p-0 shadow-none backdrop-blur-none"
      >
        <div className="min-w-[372px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-xs">
          <div className="p-2 pb-1">
            <Input
              data-testid="member-selector-search"
              showLeftIcon
              value={searchValue}
              onChange={e => setSearchValue(e.target.value)}
            />
          </div>
          <div className="p-1">
            {filteredList.map(account => (
              <div
                key={account.id}
                data-testid="member-selector-item"
                className="flex cursor-pointer items-center gap-2 rounded-lg py-1 pr-3 pl-2 hover:bg-state-base-hover"
                onClick={() => {
                  onSelect(account.id)
                  setOpen(false)
                }}
              >
                <Avatar avatar={account.avatar_url} size="sm" name={account.name} />
                <div className="grow truncate system-sm-medium text-text-secondary">{account.name}</div>
                <div className="system-xs-regular text-text-quaternary">{account.email}</div>
              </div>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default MemberSelector
