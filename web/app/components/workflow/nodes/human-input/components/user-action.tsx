import type { FC } from 'react'
import type { UserAction } from '../types'
import {
  RiDeleteBinLine,
} from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import { genActionId } from '../utils'
import ButtonStyleDropdown from './button-style-dropdown'

const i18nPrefix = 'nodes.humanInput'

type UserActionItemProps = {
  data: UserAction
  onChange: (state: UserAction) => void
  onDelete: (id: string) => void
  readonly?: boolean
}

const UserActionItem: FC<UserActionItemProps> = ({
  data,
  onChange,
  onDelete,
  readonly,
}) => {
  const { t } = useTranslation()

  const handleIDChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.value.trim())
      onChange({ ...data, id: genActionId() })
    else
      onChange({ ...data, id: e.target.value })
  }

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.value.trim())
      onChange({ ...data, title: 'Button Text' })
    else
      onChange({ ...data, title: e.target.value })
  }

  return (
    <div className="flex items-center gap-1">
      <div className="shrink-0">
        <Input
          wrapperClassName="w-[120px]"
          value={data.id}
          placeholder={t(`${i18nPrefix}.userActions.actionNamePlaceholder`, { ns: 'workflow' })}
          onChange={handleIDChange}
          disabled={readonly}
        />
      </div>
      <div className="grow">
        <Input
          value={data.title}
          placeholder={t(`${i18nPrefix}.userActions.buttonTextPlaceholder`, { ns: 'workflow' })}
          onChange={handleTextChange}
          disabled={readonly}
        />
      </div>
      <ButtonStyleDropdown
        text={data.title}
        data={data.button_style}
        onChange={type => onChange({ ...data, button_style: type })}
        readonly={readonly}
      />
      {!readonly && (
        <Button
          className="px-2"
          variant="tertiary"
          onClick={() => onDelete(data.id)}
        >
          <RiDeleteBinLine className="h-4 w-4" />
        </Button>
      )}
    </div>
  )
}

export default UserActionItem
