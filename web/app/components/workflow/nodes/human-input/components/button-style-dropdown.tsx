import type { FC } from 'react'
import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiFontSize,
} from '@remixicon/react'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import Button from '@/app/components/base/button'
import { UserActionButtonType } from '../types'
import cn from '@/utils/classnames'

const i18nPrefix = 'workflow.nodes.humanInput'

type Props = {
  text: string
  data: UserActionButtonType
  onChange: (state: UserActionButtonType) => void
}

const ButtonStyleDropdown: FC<Props> = ({
  text = 'Button Text',
  data,
  onChange,
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
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-end'
      offset={{
        mainAxis: 4,
        crossAxis: 44,
      }}
    >
      <PortalToFollowElemTrigger onClick={() => setOpen(v => !v)}>
        <div className={cn('flex cursor-pointer items-center justify-center rounded-lg bg-components-button-tertiary-bg p-1 hover:bg-components-button-tertiary-bg-hover', open && 'bg-components-button-tertiary-bg-hover')}>
          <Button size='small' className='pointer-events-none px-1' variant={currentStyle}>
            <RiFontSize className='h-4 w-4' />
          </Button>
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent style={{ zIndex: 1000 }}>
        <div className='rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-4 shadow-lg backdrop-blur-sm'>
          <div className='system-md-medium text-text-primary'>{t(`${i18nPrefix}.userActions.chooseStyle`)}</div>
          <div className='mt-2 flex w-[324px] flex-wrap gap-1'>
            <div
              className={cn(
                'box-border flex h-[80px] w-[160px] cursor-pointer items-center justify-center rounded-lg border-[1.5px] border-transparent bg-background-section hover:bg-background-section-burn',
                data === UserActionButtonType.Primary && 'border-components-option-card-option-selected-border',
              )}
              onClick={() => onChange(UserActionButtonType.Primary)}
            >
              <Button variant='primary' className='pointer-events-none'>{text}</Button>
            </div>
            <div
              className={cn(
                'box-border flex h-[80px] w-[160px] cursor-pointer items-center justify-center rounded-lg border-[1.5px] border-transparent bg-background-section hover:bg-background-section-burn',
                data === UserActionButtonType.Default && 'border-components-option-card-option-selected-border',
              )}
              onClick={() => onChange(UserActionButtonType.Default)}
            >
              <Button variant='secondary' className='pointer-events-none'>{text}</Button>
            </div>
            <div
              className={cn(
                'box-border flex h-[80px] w-[160px] cursor-pointer items-center justify-center rounded-lg border-[1.5px] border-transparent bg-background-section hover:bg-background-section-burn',
                data === UserActionButtonType.Accent && 'border-components-option-card-option-selected-border',
              )}
              onClick={() => onChange(UserActionButtonType.Accent)}
            >
              <Button variant='secondary-accent' className='pointer-events-none'>{text}</Button>
            </div>
            <div
              className={cn(
                'box-border flex h-[80px] w-[160px] cursor-pointer items-center justify-center rounded-lg border-[1.5px] border-transparent bg-background-section hover:bg-background-section-burn',
                data === UserActionButtonType.Ghost && 'border-components-option-card-option-selected-border',
              )}
              onClick={() => onChange(UserActionButtonType.Ghost)}
            >
              <Button variant='ghost' className='pointer-events-none'>{text}</Button>
            </div>
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default ButtonStyleDropdown
