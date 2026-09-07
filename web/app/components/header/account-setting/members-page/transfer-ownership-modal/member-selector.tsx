'use client'
import type { FC } from 'react'
import { Avatar } from '@langgenius/dify-ui/avatar'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@langgenius/dify-ui/input-group'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import * as React from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMembers } from '@/service/use-common'

type Props = Readonly<{
  value?: string
  onSelect: (value: string) => void
  exclude?: string[]
}>

const MemberSelector: FC<Props> = ({ value, onSelect, exclude = [] }) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const searchLabel = t(($) => $['operation.search'], { ns: 'common' })

  const { data } = useMembers()

  const currentValue = useMemo(() => {
    if (!data?.accounts || !value) return null
    return data.accounts.find((account) => account.id === value) ?? null
  }, [data, value])

  const filteredList = useMemo(() => {
    if (!data?.accounts) return []
    const accounts = data.accounts
    if (!searchValue) return accounts.filter((account) => !exclude.includes(account.id))
    return accounts
      .filter((account) => {
        const name = account.name || ''
        const email = account.email || ''
        return (
          name.toLowerCase().includes(searchValue.toLowerCase()) ||
          email.toLowerCase().includes(searchValue.toLowerCase())
        )
      })
      .filter((account) => !exclude.includes(account.id))
  }, [data, exclude, searchValue])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="group flex cursor-pointer appearance-none items-center gap-1.5 rounded-lg bg-components-input-bg-normal px-2 py-1 text-start outline-hidden hover:bg-state-base-hover-alt focus-visible:ring-2 focus-visible:ring-state-accent-solid data-popup-open:bg-state-base-hover-alt"
          />
        }
      >
        {!currentValue && (
          <span className="grow p-1 system-sm-regular text-components-input-text-placeholder">
            {t(($) => $['members.transferModal.transferPlaceholder'], { ns: 'common' })}
          </span>
        )}
        {currentValue && (
          <>
            <span aria-hidden>
              <Avatar avatar={currentValue.avatar_url} size="sm" name={currentValue.name} />
            </span>
            <span className="grow truncate system-sm-medium text-text-secondary">
              {currentValue.name}
            </span>
            <span className="system-xs-regular text-text-quaternary">{currentValue.email}</span>
          </>
        )}
        <span
          aria-hidden
          className="i-ri-arrow-down-s-line size-4 text-text-quaternary group-hover:text-text-secondary group-data-popup-open:text-text-secondary"
        />
      </PopoverTrigger>
      <PopoverContent
        placement="bottom"
        sideOffset={4}
        className="border-none bg-transparent p-0 shadow-none backdrop-blur-none"
      >
        <div className="min-w-93 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-xs">
          <div className="p-2 pb-1">
            <InputGroup>
              <InputGroupInput
                type="search"
                aria-label={searchLabel}
                autoComplete="off"
                className="[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
                placeholder={searchLabel}
                value={searchValue}
                onValueChange={setSearchValue}
              />
              <InputGroupAddon className="ps-2 pe-0.5">
                <span
                  aria-hidden="true"
                  className="i-ri-search-line size-4 text-components-input-text-placeholder"
                />
              </InputGroupAddon>
            </InputGroup>
          </div>
          <div className="p-1">
            {filteredList.map((account) => (
              <button
                type="button"
                key={account.id}
                className="flex w-full cursor-pointer appearance-none items-center gap-2 rounded-lg py-1 pr-3 pl-2 text-start outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                onClick={() => {
                  onSelect(account.id)
                  setOpen(false)
                }}
              >
                <span aria-hidden>
                  <Avatar avatar={account.avatar_url} size="sm" name={account.name} />
                </span>
                <span className="grow truncate system-sm-medium text-text-secondary">
                  {account.name}
                </span>
                <span className="system-xs-regular text-text-quaternary">{account.email}</span>
              </button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default MemberSelector
