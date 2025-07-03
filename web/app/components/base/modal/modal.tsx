import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { RiCloseLine } from '@remixicon/react'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
} from '@/app/components/base/portal-to-follow-elem'
import Button from '@/app/components/base/button'
import type { ButtonProps } from '@/app/components/base/button'
import cn from '@/utils/classnames'

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
}: ModalProps) => {
  const { t } = useTranslation()

  return (
    <PortalToFollowElem open>
      <PortalToFollowElemContent
        className='z-[999999] flex h-full w-full items-center justify-center bg-background-overlay'
        onClick={onClose}
      >
        <div
          className={cn(
            'max-h-[80%] w-[480px] overflow-y-auto rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xs',
            size === 'sm' && 'w-[480px',
            size === 'md' && 'w-[640px]',
          )}
          onClick={e => e.stopPropagation()}
        >
          <div className='title-2xl-semi-bold relative p-6 pb-3 pr-14 text-text-primary'>
            {title}
            {
              subTitle && (
                <div className='system-xs-regular mt-1 text-text-tertiary'>
                  {subTitle}
                </div>
              )
            }
            <div
              className='absolute right-5 top-5 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg'
              onClick={onClose}
            >
              <RiCloseLine className='h-5 w-5 text-text-tertiary' />
            </div>
          </div>
          {
            children && (
              <div className='px-6 py-3'>{children}</div>
            )
          }
          <div className='flex items-center justify-end p-6 pt-5'>
            {footerSlot}
            {
              showExtraButton && (
                <>
                  <Button
                    variant={extraButtonVariant}
                    onClick={onExtraButtonClick}
                  >
                    {extraButtonText || t('common.operation.remove')}
                  </Button>
                  <div className='mx-3 h-4 w-[1px] bg-divider-regular'></div>
                </>
              )
            }
            <Button
              onClick={onCancel}
            >
              {cancelButtonText || t('common.operation.cancel')}
            </Button>
            <Button
              className='ml-2'
              variant='primary'
              onClick={onConfirm}
            >
              {confirmButtonText || t('common.operation.save')}
            </Button>
          </div>
          {bottomSlot}
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default memo(Modal)
