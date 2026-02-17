'use client'
import type { FC } from 'react'
import type { Recipient } from '@/app/components/workflow/nodes/human-input/types'
import type { Member } from '@/models/common'
import {
  RiContactsBookLine,
} from '@remixicon/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { PortalToFollowElem, PortalToFollowElemContent, PortalToFollowElemTrigger } from '@/app/components/base/portal-to-follow-elem'
import { cn } from '@/utils/classnames'
import MemberList from './member-list'

const i18nPrefix = 'nodes.humanInput'

type Props = {
  value: Recipient[]
  email: string
  onSelect: (value: string) => void
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
      placement="bottom-end"
      offset={{
        mainAxis: 4,
        crossAxis: 35,
      }}
    >
      <PortalToFollowElemTrigger
        className="w-full"
        onClick={() => setOpen(v => !v)}
      >
        <Button
          className={cn('w-full justify-between', open && 'bg-state-accent-hover')}
          variant="ghost-accent"
        >
          <RiContactsBookLine className="mr-1 h-4 w-4" />
          <div className="">{t(`${i18nPrefix}.deliveryMethod.emailConfigure.memberSelector.trigger`, { ns: 'workflow' })}</div>
        </Button>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className="z-[1000]">
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
