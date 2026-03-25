import type { Recipient as RecipientItem } from '../../../types'
import type { Member } from '@/models/common'
import * as React from 'react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { cn } from '@/utils/classnames'
import EmailItem from './email-item'
import MemberList from './member-list'

const i18nPrefix = 'nodes.humanInput'

type Props = {
  email: string
  value: RecipientItem[]
  list: Member[]
  onDelete: (recipient: RecipientItem) => void
  onSelect: (value: string) => void
  onAdd: (email: string) => void
  disabled?: boolean
}

const EmailInput = ({
  email,
  value,
  list,
  onDelete,
  onSelect,
  onAdd,
  disabled = false,
}: Props) => {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [isFocus, setIsFocus] = useState(false)
  const [open, setOpen] = useState(false)
  const [searchKey, setSearchKey] = useState('')

  const selectedEmails = useMemo(() => {
    return value.map((item) => {
      const member = list.find(account => account.id === item.user_id)
      return member ? { ...item, email: member.email, name: member.name } : item
    })
  }, [list, value])

  const isErrorMember = useCallback((emailItem: RecipientItem) => emailItem.type === 'member' && list.every(item => item.id !== emailItem.user_id), [list])

  const placeholder = useMemo(() => {
    return (selectedEmails.length === 0 || isFocus)
      ? t(`${i18nPrefix}.deliveryMethod.emailConfigure.memberSelector.placeholder`, { ns: 'workflow' })
      : ''
  }, [selectedEmails, t, isFocus])

  const setInputFocus = () => {
    if (disabled)
      return
    setIsFocus(true)
    const input = inputRef.current?.children[0] as HTMLInputElement
    input?.focus()
  }

  const handleValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchKey(e.target.value)
    if (e.target.value.trim() === '') {
      setOpen(false)
      return
    }
    setOpen(true)
  }

  const handleSelect = (value: string) => {
    setSearchKey('')
    setOpen(false)
    onSelect(value)
    setInputFocus()
  }

  const checkEmailValid = (email: string) => {
    const emailRegex = /^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/
    return emailRegex.test(email)
  }

  const handleEmailAdd = () => {
    const emailAddress = searchKey.trim()
    if (!checkEmailValid(emailAddress))
      return
    if (value.some(item => item.email === emailAddress))
      return
    if (list.some(item => item.email === emailAddress)) {
      const item = list.find(item => item.email === emailAddress)!
      onSelect(item.id)
    }
    else {
      onAdd(emailAddress)
    }
    setSearchKey('')
    setOpen(false)
  }

  const handleInputBlur = () => {
    setIsFocus(false)
    handleEmailAdd()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === 'Tab' || e.key === ' ' || e.key === ',') {
      e.preventDefault()
      handleEmailAdd()
    }
    else if (e.key === 'Backspace') {
      if (searchKey === '' && value.length > 0) {
        e.preventDefault()
        onDelete(value[value.length - 1])
        setSearchKey('')
        setOpen(false)
      }
    }
  }

  return (
    <div className="p-1 pt-0">
      <div
        className={cn(
          'flex max-h-24 min-h-16 flex-wrap overflow-y-auto rounded-lg border border-transparent bg-components-input-bg-normal p-2',
          isFocus && 'border-components-input-border-active bg-components-input-bg-active shadow-xs',
          !disabled && 'hover:border-components-input-border-hover hover:bg-components-input-bg-hover',
        )}
        onClick={setInputFocus}
      >
        {selectedEmails.map(item => (
          <EmailItem
            key={item.user_id || item.email}
            email={email}
            data={item as unknown as Member}
            onDelete={onDelete}
            disabled={disabled}
            isError={isErrorMember(item)}
          />
        ))}
        {!disabled && (
          <PortalToFollowElem
            open={open}
            onOpenChange={setOpen}
            placement="bottom-start"
            offset={{
              mainAxis: 4,
              crossAxis: -40,
            }}
          >
            <PortalToFollowElemTrigger className="block h-6 min-w-[166px]">
              <input
                ref={inputRef}
                className="system-sm-regular h-6 min-w-[166px] appearance-none bg-transparent p-1 text-components-input-text-filled caret-primary-600 outline-none placeholder:text-components-input-text-placeholder"
                placeholder={placeholder}
                onFocus={() => setIsFocus(true)}
                onBlur={handleInputBlur}
                value={searchKey}
                onChange={handleValueChange}
                onKeyDown={handleKeyDown}
              />
            </PortalToFollowElemTrigger>
            <PortalToFollowElemContent className="z-[1000]">
              <MemberList
                searchValue={searchKey}
                list={list}
                value={value}
                onSearchChange={setSearchKey}
                onSelect={handleSelect}
                email={email}
                hideSearch
              />
            </PortalToFollowElemContent>
          </PortalToFollowElem>
        )}
      </div>
    </div>
  )
}

export default EmailInput
