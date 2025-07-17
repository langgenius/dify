'use client'
import type { FC } from 'react'
import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'
import {
  RiArrowDownSLine,
} from '@remixicon/react'
import { PortalToFollowElem, PortalToFollowElemContent, PortalToFollowElemTrigger } from '@/app/components/base/portal-to-follow-elem'
import Avatar from '@/app/components/base/avatar'
import Input from '@/app/components/base/input'
import { fetchMembers } from '@/service/common'
import cn from '@/utils/classnames'

type Props = {
  value?: any
  onSelect: (value: any) => void
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

  const { data } = useSWR(
    {
      url: '/workspaces/current/members',
      params: {},
    },
    fetchMembers,
  )

  const currentValue = useMemo(() => {
    if (!data?.accounts) return null
    const accounts = data.accounts || []
    if (!value) return null
    return accounts.find(account => account.id === value)
  }, [data, value])

  const filteredList = useMemo(() => {
    if (!data?.accounts) return []
    const accounts = data.accounts
    if (!searchValue) return accounts.filter(account => !exclude.includes(account.id))
    return accounts.filter((account) => {
      const name = account.name || ''
      const email = account.email || ''
      return name.toLowerCase().includes(searchValue.toLowerCase())
        || email.toLowerCase().includes(searchValue.toLowerCase())
    }).filter(account => !exclude.includes(account.id))
  }, [data, searchValue, exclude])

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom'
      offset={4}
    >
      <PortalToFollowElemTrigger
        className='w-full'
        onClick={() => setOpen(v => !v)}
      >
        <div className={cn('group flex cursor-pointer items-center gap-1.5 rounded-lg bg-components-input-bg-normal px-2 py-1 hover:bg-state-base-hover-alt', open && 'bg-state-base-hover-alt')}>
          {!currentValue && (
            <div className='system-sm-regular grow p-1 text-components-input-text-placeholder'>{t('common.members.transferModal.transferPlaceholder')}</div>
          )}
          {currentValue && (
            <>
              <Avatar avatar={currentValue.avatar_url} size={24} name={currentValue.name} />
              <div className='system-sm-medium grow truncate text-text-secondary'>{currentValue.name}</div>
              <div className='system-xs-regular text-text-quaternary'>{currentValue.email}</div>
            </>
          )}
          <RiArrowDownSLine className={cn('h-4 w-4 text-text-quaternary group-hover:text-text-secondary', open && 'text-text-secondary')} />
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-[1000]'>
        <div className='min-w-[372px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-sm'>
          <div className='p-2 pb-1'>
            <Input
              showLeftIcon
              value={searchValue}
              onChange={e => setSearchValue(e.target.value)}
            />
          </div>
          <div className='p-1'>
            {filteredList.map(account => (
              <div
                key={account.id}
                className='flex cursor-pointer items-center gap-2 rounded-lg py-1 pl-2 pr-3 hover:bg-state-base-hover'
                onClick={() => {
                  onSelect(account.id)
                  setOpen(false)
                }}
              >
                <Avatar avatar={account.avatar_url} size={24} name={account.name} />
                <div className='system-sm-medium grow truncate text-text-secondary'>{account.name}</div>
                <div className='system-xs-regular text-text-quaternary'>{account.email}</div>
              </div>
            ))}
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}
export default MemberSelector
