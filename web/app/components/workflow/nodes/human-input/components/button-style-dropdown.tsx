import type { FC } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import {
  RiFontSize,
} from '@remixicon/react'
import * as React from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { UserActionButtonType } from '../types'

const i18nPrefix = 'nodes.humanInput'

type Props = {
  text: string
  data: UserActionButtonType
  onChange: (state: UserActionButtonType) => void
  readonly?: boolean
}

const ButtonStyleDropdown: FC<Props> = ({
  text = 'Button Text',
  data,
  onChange,
  readonly,
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const currentStyle = useMemo(() => {
    switch (data) {
      case UserActionButtonType.Primary:
        return 'primary'
      case UserActionButtonType.Default:
        return 'secondary'
      case UserActionButtonType.Accent:
        return 'secondary-accent'
      default:
        return 'ghost'
    }
  }, [data])

  return (
    <Popover
      open={open && !readonly}
      onOpenChange={(nextOpen) => {
        if (readonly)
          return
        setOpen(nextOpen)
      }}
    >
      <PopoverTrigger
        render={(
          <div className={cn('flex items-center justify-center rounded-lg bg-components-button-tertiary-bg p-1', !readonly && 'cursor-pointer hover:bg-components-button-tertiary-bg-hover', open && 'bg-components-button-tertiary-bg-hover')}>
            <Button size="small" className="pointer-events-none px-1" variant={currentStyle}>
              <RiFontSize className="h-4 w-4" />
            </Button>
          </div>
        )}
      />
      <PopoverContent
        placement="bottom-end"
        sideOffset={4}
        alignOffset={44}
        popupClassName="border-none bg-transparent shadow-none"
      >
        <div className="rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-4 shadow-lg backdrop-blur-xs">
          <div className="system-md-medium text-text-primary">{t(`${i18nPrefix}.userActions.chooseStyle`, { ns: 'workflow' })}</div>
          <div className="mt-2 flex w-[324px] flex-wrap gap-1">
            <div
              className={cn(
                'box-border flex h-[80px] w-[160px] cursor-pointer items-center justify-center rounded-lg border-[1.5px] border-transparent bg-background-section hover:bg-background-section-burn',
                data === UserActionButtonType.Primary && 'border-components-option-card-option-selected-border',
              )}
              onClick={() => onChange(UserActionButtonType.Primary)}
            >
              <Button variant="primary" className="pointer-events-none">{text}</Button>
            </div>
            <div
              className={cn(
                'box-border flex h-[80px] w-[160px] cursor-pointer items-center justify-center rounded-lg border-[1.5px] border-transparent bg-background-section hover:bg-background-section-burn',
                data === UserActionButtonType.Default && 'border-components-option-card-option-selected-border',
              )}
              onClick={() => onChange(UserActionButtonType.Default)}
            >
              <Button variant="secondary" className="pointer-events-none">{text}</Button>
            </div>
            <div
              className={cn(
                'box-border flex h-[80px] w-[160px] cursor-pointer items-center justify-center rounded-lg border-[1.5px] border-transparent bg-background-section hover:bg-background-section-burn',
                data === UserActionButtonType.Accent && 'border-components-option-card-option-selected-border',
              )}
              onClick={() => onChange(UserActionButtonType.Accent)}
            >
              <Button variant="secondary-accent" className="pointer-events-none">{text}</Button>
            </div>
            <div
              className={cn(
                'box-border flex h-[80px] w-[160px] cursor-pointer items-center justify-center rounded-lg border-[1.5px] border-transparent bg-background-section hover:bg-background-section-burn',
                data === UserActionButtonType.Ghost && 'border-components-option-card-option-selected-border',
              )}
              onClick={() => onChange(UserActionButtonType.Ghost)}
            >
              <Button variant="ghost" className="pointer-events-none">{text}</Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default ButtonStyleDropdown
