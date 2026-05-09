'use client'
// eslint-disable-next-line no-restricted-imports -- Temporary legacy drawer exception: remove this direct Base UI wrapper after callers migrate to dify-ui drawer primitives.
import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'

export type IDrawerProps = {
  title?: string
  description?: string
  dialogClassName?: string
  dialogBackdropClassName?: string
  containerClassName?: string
  panelClassName?: string
  children: React.ReactNode
  footer?: React.ReactNode
  mask?: boolean
  positionCenter?: boolean
  isOpen: boolean
  showClose?: boolean
  clickOutsideNotOpen?: boolean
  onClose: () => void
  onCancel?: () => void
  onOk?: () => void
  unmount?: boolean
  noOverlay?: boolean
}

export default function Drawer({
  title = '',
  description = '',
  dialogClassName = '',
  dialogBackdropClassName = '',
  containerClassName = '',
  panelClassName = '',
  children,
  footer,
  mask = true,
  positionCenter,
  showClose = false,
  isOpen,
  clickOutsideNotOpen,
  onClose,
  onCancel,
  onOk,
  unmount = false,
  noOverlay = false,
}: IDrawerProps) {
  const { t } = useTranslation()
  return (
    <BaseDialog.Root
      open={isOpen}
      disablePointerDismissal={clickOutsideNotOpen}
      onOpenChange={(open) => {
        if (!open && !clickOutsideNotOpen)
          onClose()
      }}
    >
      <BaseDialog.Portal>
        <div className={cn('fixed inset-0 z-30 overflow-y-auto', dialogClassName)}>
          <div className={cn('flex h-screen w-screen justify-end', positionCenter && 'justify-center!', containerClassName)}>
            {!noOverlay && (
              <BaseDialog.Backdrop
                className={cn('fixed inset-0 z-40', mask && 'bg-black/30', dialogBackdropClassName)}
              />
            )}
            <BaseDialog.Popup
              data-unmount={unmount}
              className={cn('relative z-50 flex w-full max-w-sm flex-col justify-between overflow-hidden bg-components-panel-bg p-6 text-left align-middle shadow-xl', panelClassName)}
            >
              <>
                <div className="flex justify-between">
                  {title && (
                    <BaseDialog.Title
                      render={<h3 />}
                      className="text-lg leading-6 font-medium text-text-primary"
                    >
                      {title}
                    </BaseDialog.Title>
                  )}
                  {showClose && (
                    <div className="mb-4 flex cursor-pointer items-center">
                      <span
                        className="i-heroicons-x-mark h-4 w-4 text-text-tertiary"
                        onClick={onClose}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ')
                            onClose()
                        }}
                        role="button"
                        tabIndex={0}
                        aria-label={t('operation.close', { ns: 'common' })}
                        data-testid="close-icon"
                      />
                    </div>
                  )}
                </div>
                {description && <div className="mt-2 text-xs font-normal text-text-tertiary">{description}</div>}
                {children}
              </>
              {footer || (footer === null
                ? null
                : (
                    <div className="mt-10 flex flex-row justify-end">
                      <Button
                        className="mr-2"
                        onClick={() => {
                          onCancel?.()
                        }}
                      >
                        {t('operation.cancel', { ns: 'common' })}
                      </Button>
                      <Button
                        onClick={() => {
                          onOk?.()
                        }}
                      >
                        {t('operation.save', { ns: 'common' })}
                      </Button>
                    </div>
                  ))}
            </BaseDialog.Popup>
          </div>
        </div>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}
