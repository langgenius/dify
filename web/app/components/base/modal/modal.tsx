import type { ButtonProps } from '@/app/components/base/button'
import { RiCloseLine } from '@remixicon/react'
import { noop } from 'es-toolkit/function'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
} from '@/app/components/base/portal-to-follow-elem'
import { cn } from '@/utils/classnames'

type ModalProps = {
  onClose?: () => void
  size?: 'sm' | 'md'
  title: string
  subTitle?: string
  children?: React.ReactNode
  confirmButtonText?: string
  onConfirm?: () => void
  cancelButtonText?: string
  onCancel?: () => void
  showExtraButton?: boolean
  extraButtonText?: string
  extraButtonVariant?: ButtonProps['variant']
  onExtraButtonClick?: () => void
  footerSlot?: React.ReactNode
  bottomSlot?: React.ReactNode
  disabled?: boolean
  containerClassName?: string
  wrapperClassName?: string
  clickOutsideNotClose?: boolean
}
const Modal = ({
  onClose,
  size = 'sm',
  title,
  subTitle,
  children,
  confirmButtonText,
  onConfirm,
  cancelButtonText,
  onCancel,
  showExtraButton,
  extraButtonVariant = 'warning',
  extraButtonText,
  onExtraButtonClick,
  footerSlot,
  bottomSlot,
  disabled,
  containerClassName,
  wrapperClassName,
  clickOutsideNotClose = false,
}: ModalProps) => {
  const { t } = useTranslation()

  return (
    <PortalToFollowElem open>
      <PortalToFollowElemContent
        className={cn('z-[9998] flex h-full w-full items-center justify-center bg-background-overlay', wrapperClassName)}
        onClick={clickOutsideNotClose ? noop : onClose}
      >
        <div
          className={cn(
            'flex max-h-[80%] flex-col rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xs',
            size === 'sm' && 'w-[480px]',
            size === 'md' && 'w-[640px]',
            containerClassName,
          )}
          onClick={e => e.stopPropagation()}
        >
          <div className="title-2xl-semi-bold relative shrink-0 p-6 pb-3 pr-14 text-text-primary">
            {title}
            {
              subTitle && (
                <div className="system-xs-regular mt-1 text-text-tertiary">
                  {subTitle}
                </div>
              )
            }
            <div
              className="absolute right-5 top-5 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg"
              onClick={onClose}
            >
              <RiCloseLine className="h-5 w-5 text-text-tertiary" />
            </div>
          </div>
          {
            !!children && (
              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-3">{children}</div>
            )
          }
          <div className="flex shrink-0 justify-between p-6 pt-5">
            <div>
              {footerSlot}
            </div>
            <div className="flex items-center">
              {
                showExtraButton && (
                  <>
                    <Button
                      variant={extraButtonVariant}
                      onClick={onExtraButtonClick}
                      disabled={disabled}
                    >
                      {extraButtonText || t('operation.remove', { ns: 'common' })}
                    </Button>
                    <div className="mx-3 h-4 w-[1px] bg-divider-regular"></div>
                  </>
                )
              }
              <Button
                onClick={onCancel}
                disabled={disabled}
              >
                {cancelButtonText || t('operation.cancel', { ns: 'common' })}
              </Button>
              <Button
                className="ml-2"
                variant="primary"
                onClick={onConfirm}
                disabled={disabled}
              >
                {confirmButtonText || t('operation.save', { ns: 'common' })}
              </Button>
            </div>
          </div>
          {!!bottomSlot && (
            <div className="shrink-0">
              {bottomSlot}
            </div>
          )}
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default memo(Modal)
