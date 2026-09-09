import type { FC } from 'react'
import type { UserAction } from '../types'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Input } from '@langgenius/dify-ui/input'
import { toast } from '@langgenius/dify-ui/toast'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import ButtonStyleDropdown from './button-style-dropdown'

const i18nPrefix = 'nodes.humanInput'
const ACTION_ID_MAX_LENGTH = 20
const ACTION_VALUE_MAX_LENGTH = 100

type UserActionItemProps = {
  data: UserAction
  onChange: (state: UserAction) => void
  onDelete: (id: string) => void
  readonly?: boolean
}

const UserActionItem: FC<UserActionItemProps> = ({ data, onChange, onDelete, readonly }) => {
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
        if (index === 0) return /^[a-z_]$/i.test(char)
        return /^\w$/.test(char)
      })
      .join('')

    if (sanitized !== withUnderscores) {
      toast.error(t(($) => $[`${i18nPrefix}.userActions.actionIdFormatTip`], { ns: 'workflow' }))
      return
    }

    // Limit to 20 characters
    if (sanitized.length > ACTION_ID_MAX_LENGTH) {
      sanitized = sanitized.slice(0, ACTION_ID_MAX_LENGTH)
      toast.error(
        t(($) => $[`${i18nPrefix}.userActions.actionIdTooLong`], {
          ns: 'workflow',
          maxLength: ACTION_ID_MAX_LENGTH,
        }),
      )
    }

    if (sanitized) onChange({ ...data, id: sanitized })
  }

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value
    if (value.length > ACTION_VALUE_MAX_LENGTH) {
      value = value.slice(0, ACTION_VALUE_MAX_LENGTH)
      toast.error(
        t(($) => $[`${i18nPrefix}.userActions.buttonTextTooLong`], {
          ns: 'workflow',
          maxLength: ACTION_VALUE_MAX_LENGTH,
        }),
      )
    }
    onChange({ ...data, title: value })
  }

  return (
    <div className="flex items-center gap-1">
      <div className="shrink-0">
        <Input
          aria-label={t(($) => $[`${i18nPrefix}.userActions.actionNamePlaceholder`], {
            ns: 'workflow',
          })}
          className="w-30"
          value={data.id}
          placeholder={t(($) => $[`${i18nPrefix}.userActions.actionNamePlaceholder`], {
            ns: 'workflow',
          })}
          onChange={handleIDChange}
          disabled={readonly}
        />
      </div>
      <div className="grow">
        <Input
          aria-label={t(($) => $[`${i18nPrefix}.userActions.buttonTextPlaceholder`], {
            ns: 'workflow',
          })}
          value={data.title}
          placeholder={t(($) => $[`${i18nPrefix}.userActions.buttonTextPlaceholder`], {
            ns: 'workflow',
          })}
          onChange={handleTextChange}
          disabled={readonly}
        />
      </div>
      <ButtonStyleDropdown
        text={data.title}
        data={data.button_style}
        onChange={(type) => onChange({ ...data, button_style: type })}
        readonly={readonly}
      />
      {!readonly && (
        <IconButton
          aria-label={t(($) => $['operation.delete'], { ns: 'common' })}
          size="lg"
          variant="tertiary"
          onClick={() => onDelete(data.id)}
        >
          <span aria-hidden className="i-ri-delete-bin-line size-4" />
        </IconButton>
      )}
    </div>
  )
}

export default UserActionItem
