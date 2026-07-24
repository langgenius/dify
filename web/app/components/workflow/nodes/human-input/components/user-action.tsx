import type { FC } from 'react'
import type { UserAction } from '../types'
import {
  RiDeleteBinLine,
} from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Toast from '@/app/components/base/toast'
import ButtonStyleDropdown from './button-style-dropdown'

const i18nPrefix = 'nodes.humanInput'
const ACTION_ID_MAX_LENGTH = 20
const BUTTON_TEXT_MAX_LENGTH = 20

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
    const value = e.target.value
    if (!value.trim()) {
      onChange({ ...data, id: '' })
      return
    }
    // Convert spaces to underscores, then only allow characters matching /^[A-Za-z_][A-Za-z0-9_]*$/
    const withUnderscores = value.replace(/ /g, '_')
    let sanitized = withUnderscores
      .split('')
      .filter((char, index) => {
        if (index === 0)
          return /^[a-z_]$/i.test(char)
        return /^\w$/.test(char)
      })
      .join('')

    if (sanitized !== withUnderscores) {
      Toast.notify({ type: 'error', message: t(`${i18nPrefix}.userActions.actionIdFormatTip`, { ns: 'workflow' }) })
      return
    }

    // Limit to 20 characters
    if (sanitized.length > ACTION_ID_MAX_LENGTH) {
      sanitized = sanitized.slice(0, ACTION_ID_MAX_LENGTH)
      Toast.notify({ type: 'error', message: t(`${i18nPrefix}.userActions.actionIdTooLong`, { ns: 'workflow', maxLength: ACTION_ID_MAX_LENGTH }) })
    }

    if (sanitized)
      onChange({ ...data, id: sanitized })
  }

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value
    if (value.length > BUTTON_TEXT_MAX_LENGTH) {
      value = value.slice(0, BUTTON_TEXT_MAX_LENGTH)
      Toast.notify({ type: 'error', message: t(`${i18nPrefix}.userActions.buttonTextTooLong`, { ns: 'workflow', maxLength: BUTTON_TEXT_MAX_LENGTH }) })
    }
    onChange({ ...data, title: value })
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
