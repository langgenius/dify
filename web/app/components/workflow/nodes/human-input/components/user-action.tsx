import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiDeleteBinLine,
} from '@remixicon/react'
import type { UserAction } from '../types'
import Input from '@/app/components/base/input'
import Button from '@/app/components/base/button'
import ButtonStyleDropdown from './button-style-dropdown'

const i18nPrefix = 'workflow.nodes.humanInput'

type Props = {
  data: UserAction
  onChange: (state: UserAction) => void
  onDelete: (id: string) => void
}

const UserActionItem: FC<Props> = ({
  data,
  onChange,
  onDelete,
}) => {
  const { t } = useTranslation()
  return (
    <div className='flex items-center gap-1'>
      <div className='shrink-0'>
        <Input
          wrapperClassName='w-[120px]'
          value={data.id}
          placeholder={t(`${i18nPrefix}.userActions.actionNamePlaceholder`)}
          onChange={e => onChange({ ...data, id: e.target.value })}
        />
      </div>
      <div className='grow'>
        <Input
          value={data.title}
          placeholder={t(`${i18nPrefix}.userActions.buttonTextPlaceholder`)}
          onChange={e => onChange({ ...data, title: e.target.value })}
        />
      </div>
      <ButtonStyleDropdown
        text={data.title}
        data={data.button_style}
        onChange={type => onChange({ ...data, button_style: type })}
      />
      <Button
        className='px-2'
        variant='tertiary'
        onClick={() => onDelete(data.id)}
      >
        <RiDeleteBinLine className='h-4 w-4' />
      </Button>
    </div>
  )
}

export default UserActionItem
