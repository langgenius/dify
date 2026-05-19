'use client'
import type { FC } from 'react'
import type { Recipient } from '@/app/components/workflow/nodes/human-input/types'
import type { Member } from '@/models/common'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import {
  RiContactsBookLine,
} from '@remixicon/react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
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

  const handleSelect = useCallback((memberId: string) => {
    onSelect(memberId)
    setOpen(false)
  }, [onSelect])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={(
          <Button
            className={cn('w-full justify-between', open && 'bg-state-accent-hover')}
            variant="ghost-accent"
          >
            <RiContactsBookLine className="mr-1 h-4 w-4" />
            <div>{t(`${i18nPrefix}.deliveryMethod.emailConfigure.memberSelector.trigger`, { ns: 'workflow' })}</div>
          </Button>
        )}
      />
      <PopoverContent
        placement="bottom-end"
        sideOffset={4}
        alignOffset={35}
        popupClassName="border-none bg-transparent p-0 shadow-none backdrop-blur-none"
      >
        <MemberList
          searchValue={searchValue}
          list={list}
          value={value}
          onSearchChange={setSearchValue}
          onSelect={handleSelect}
          email={email}
        />
      </PopoverContent>
    </Popover>
  )
}

export default MemberSelector
