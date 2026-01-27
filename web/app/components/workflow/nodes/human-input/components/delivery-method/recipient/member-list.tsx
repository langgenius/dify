'use client'
import type { FC } from 'react'
import type { Recipient } from '@/app/components/workflow/nodes/human-input/types'
import type { Member } from '@/models/common'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Avatar from '@/app/components/base/avatar'
import Input from '@/app/components/base/input'
import { cn } from '@/utils/classnames'

const i18nPrefix = 'nodes.humanInput'

type Props = {
  value: Recipient[]
  searchValue: string
  onSearchChange: (value: string) => void
  list: Member[]
  onSelect: (value: string) => void
  email: string
  hideSearch?: boolean
}

const MemberList: FC<Props> = ({ searchValue, list, value, onSearchChange, onSelect, email, hideSearch }) => {
  const { t } = useTranslation()

  const filteredList = useMemo(() => {
    if (!list.length)
      return []
    if (!searchValue)
      return list
    return list.filter((account) => {
      const name = account.name || ''
      const email = account.email || ''
      return name.toLowerCase().includes(searchValue.toLowerCase())
        || email.toLowerCase().includes(searchValue.toLowerCase())
    })
  }, [list, searchValue])

  if (hideSearch && filteredList.length === 0)
    return null

  return (
    <div className="min-w-[320px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-sm">
      {!hideSearch && (
        <div className="p-2 pb-1">
          <Input
            showLeftIcon
            value={searchValue}
            onChange={e => onSearchChange(e.target.value)}
          />
        </div>
      )}
      {filteredList.length > 0 && (
        <div className="max-h-[248px] overflow-y-auto p-1">
          {filteredList.map(account => (
            <div
              key={account.id}
              className={cn(
                'group flex cursor-pointer items-center gap-2 rounded-lg py-1 pl-2 pr-3 hover:bg-state-base-hover',
                value.some(item => item.user_id === account.id) && 'bg-transparent hover:bg-transparent',
              )}
              onClick={() => {
                if (value.some(item => item.user_id === account.id))
                  return
                onSelect(account.id)
              }}
            >
              <Avatar className={cn(value.some(item => item.user_id === account.id) && 'opacity-50')} avatar={account.avatar_url} size={24} name={account.name} />
              <div className={cn('grow', value.some(item => item.user_id === account.id) && 'opacity-50')}>
                <div className="system-sm-medium text-text-secondary">
                  {account.name}
                  {account.status === 'pending' && <span className="system-xs-medium ml-1 text-text-warning">{t('members.pending', { ns: 'common' })}</span>}
                  {email === account.email && <span className="system-xs-regular text-text-tertiary">{t('members.you', { ns: 'common' })}</span>}
                </div>
                <div className="system-xs-regular text-text-tertiary">{account.email}</div>
              </div>
              {!value.some(item => item.user_id === account.id) && (
                <div className="system-xs-medium hidden text-text-accent group-hover:block">{t(`${i18nPrefix}.deliveryMethod.emailConfigure.memberSelector.add`, { ns: 'workflow' })}</div>
              )}
              {value.some(item => item.user_id === account.id) && (
                <div className="system-xs-regular text-text-tertiary">{t(`${i18nPrefix}.deliveryMethod.emailConfigure.memberSelector.added`, { ns: 'workflow' })}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default MemberList
