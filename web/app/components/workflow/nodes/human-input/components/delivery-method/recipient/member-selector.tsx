'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiContactsBookLine,
} from '@remixicon/react'
import { PortalToFollowElem, PortalToFollowElemContent, PortalToFollowElemTrigger } from '@/app/components/base/portal-to-follow-elem'
import Button from '@/app/components/base/button'
import MemberList from './member-list'
import type { Member } from '@/models/common'
import cn from '@/utils/classnames'

const i18nPrefix = 'workflow.nodes.humanInput'

type Props = {
  value: any[]
  email: string
  onSelect: (value: any) => void
  list: Member[]
}

const MemberSelector: FC<Props> = ({
  value,
  email,
  onSelect,
  list = [],
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-end'
      offset={{
        mainAxis: 4,
        crossAxis: 35,
      }}
    >
      <PortalToFollowElemTrigger
        className='w-full'
        onClick={() => setOpen(v => !v)}
      >
        <Button
          className={cn('w-full justify-between', open && 'bg-state-accent-hover')}
          variant='ghost-accent'
        >
          <RiContactsBookLine className='mr-1 h-4 w-4' />
          <div className=''>{t(`${i18nPrefix}.deliveryMethod.emailConfigure.memberSelector.trigger`)}</div>
        </Button>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-[1000]'>
        <MemberList
          searchValue={searchValue}
          list={list}
          value={value}
          onSearchChange={setSearchValue}
          onSelect={onSelect}
          email={email}
        />
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}
export default MemberSelector
