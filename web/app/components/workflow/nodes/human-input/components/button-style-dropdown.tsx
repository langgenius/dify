import type { FC } from 'react'
import { buttonVariants } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton, iconButtonVariants } from '@langgenius/dify-ui/icon-button'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { RadioGroup, RadioItem } from '@langgenius/dify-ui/radio-group'
import { RiFontSize } from '@remixicon/react'
import * as React from 'react'
import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { UserActionButtonType } from '../types'

const i18nPrefix = 'nodes.humanInput'

type Props = Readonly<{
  text: string
  data: UserActionButtonType
  onChange: (state: UserActionButtonType) => void
  readonly?: boolean
}>

const ButtonStyleDropdown: FC<Props> = ({ text = 'Button Text', data, onChange, readonly }) => {
  const { t } = useTranslation(['workflowHumanInput'])
  const [open, setOpen] = useState(false)
  const titleId = useId()
  const chooseStyleLabel = t(($) => $[`${i18nPrefix}.userActions.chooseStyle`], {
    ns: 'workflowHumanInput',
  })
  const accessibleLabel = `${text}: ${chooseStyleLabel}`
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
        if (readonly) return
        setOpen(nextOpen)
      }}
    >
      <PopoverTrigger
        render={
          <IconButton
            aria-label={accessibleLabel}
            variant="tertiary"
            size="lg"
            disabled={readonly}
            className="p-1 data-popup-open:bg-components-button-tertiary-bg-hover"
          >
            {/* Keep the selected style preview static while the trigger owns hover. */}
            <span
              aria-hidden
              className={cn(
                iconButtonVariants({ variant: currentStyle, size: 'md' }),
                'pointer-events-none',
              )}
            >
              <RiFontSize className="size-4" />
            </span>
          </IconButton>
        }
      />
      <PopoverContent
        placement="bottom-end"
        sideOffset={4}
        alignOffset={44}
        className="border-none bg-transparent shadow-none"
      >
        <div className="rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-4 shadow-lg backdrop-blur-xs">
          <PopoverTitle id={titleId} className="system-md-medium text-text-primary">
            {accessibleLabel}
          </PopoverTitle>
          <RadioGroup
            aria-labelledby={titleId}
            value={data}
            onValueChange={(value) => onChange(value)}
            disabled={readonly}
            className="mt-2 flex w-81 flex-wrap gap-1"
          >
            <RadioItem
              value={UserActionButtonType.Primary}
              aria-label={`${text}, ${t(($) => $[`${i18nPrefix}.userActions.buttonStyle.primary`], { ns: 'workflowHumanInput' })}`}
              nativeButton
              render={<button type="button" />}
              className="box-border flex h-20 w-40 cursor-pointer items-center justify-center rounded-lg border-[1.5px] border-transparent bg-background-section outline-hidden hover:bg-background-section-burn focus-visible:ring-2 focus-visible:ring-state-accent-solid data-checked:border-components-option-card-option-selected-border data-disabled:cursor-not-allowed"
            >
              <span className={cn(buttonVariants({ variant: 'primary' }), 'pointer-events-none')}>
                {text}
              </span>
            </RadioItem>
            <RadioItem
              value={UserActionButtonType.Default}
              aria-label={`${text}, ${t(($) => $[`${i18nPrefix}.userActions.buttonStyle.default`], { ns: 'workflowHumanInput' })}`}
              nativeButton
              render={<button type="button" />}
              className="box-border flex h-20 w-40 cursor-pointer items-center justify-center rounded-lg border-[1.5px] border-transparent bg-background-section outline-hidden hover:bg-background-section-burn focus-visible:ring-2 focus-visible:ring-state-accent-solid data-checked:border-components-option-card-option-selected-border data-disabled:cursor-not-allowed"
            >
              <span className={cn(buttonVariants({ variant: 'secondary' }), 'pointer-events-none')}>
                {text}
              </span>
            </RadioItem>
            <RadioItem
              value={UserActionButtonType.Accent}
              aria-label={`${text}, ${t(($) => $[`${i18nPrefix}.userActions.buttonStyle.accent`], { ns: 'workflowHumanInput' })}`}
              nativeButton
              render={<button type="button" />}
              className="box-border flex h-20 w-40 cursor-pointer items-center justify-center rounded-lg border-[1.5px] border-transparent bg-background-section outline-hidden hover:bg-background-section-burn focus-visible:ring-2 focus-visible:ring-state-accent-solid data-checked:border-components-option-card-option-selected-border data-disabled:cursor-not-allowed"
            >
              <span
                className={cn(
                  buttonVariants({ variant: 'secondary-accent' }),
                  'pointer-events-none',
                )}
              >
                {text}
              </span>
            </RadioItem>
            <RadioItem
              value={UserActionButtonType.Ghost}
              aria-label={`${text}, ${t(($) => $[`${i18nPrefix}.userActions.buttonStyle.ghost`], { ns: 'workflowHumanInput' })}`}
              nativeButton
              render={<button type="button" />}
              className="box-border flex h-20 w-40 cursor-pointer items-center justify-center rounded-lg border-[1.5px] border-transparent bg-background-section outline-hidden hover:bg-background-section-burn focus-visible:ring-2 focus-visible:ring-state-accent-solid data-checked:border-components-option-card-option-selected-border data-disabled:cursor-not-allowed"
            >
              <span className={cn(buttonVariants({ variant: 'ghost' }), 'pointer-events-none')}>
                {text}
              </span>
            </RadioItem>
          </RadioGroup>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default ButtonStyleDropdown
