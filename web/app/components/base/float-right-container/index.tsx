'use client'
import type { ComponentProps } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Drawer,
  DrawerBackdrop,
  DrawerCloseButton,
  DrawerContent,
  DrawerPopup,
  DrawerPortal,
  DrawerTitle,
  DrawerViewport,
} from '@langgenius/dify-ui/drawer'
import { useTranslation } from 'react-i18next'

type IFloatRightContainerProps = {
  isMobile: boolean
  isOpen: boolean
  onClose: () => void
  children?: React.ReactNode
  showClose?: boolean
  panelClassName?: string
  title?: string
  mask?: boolean
  finalFocus?: ComponentProps<typeof DrawerPopup>['finalFocus']
}

const FloatRightContainer = ({
  isMobile,
  children,
  isOpen,
  onClose,
  showClose = false,
  panelClassName,
  title,
  mask = true,
  finalFocus,
}: IFloatRightContainerProps) => {
  const { t } = useTranslation()

  return (
    <>
      {isMobile && (
        <Drawer
          open={isOpen}
          modal
          swipeDirection="right"
          onOpenChange={(open) => {
            if (!open) onClose()
          }}
        >
          <DrawerPortal>
            <DrawerBackdrop className={cn(!mask && 'bg-transparent')} />
            <DrawerViewport>
              <DrawerPopup
                finalFocus={finalFocus}
                className={cn(
                  'data-[swipe-direction=right]:w-full data-[swipe-direction=right]:max-w-sm',
                  panelClassName,
                )}
              >
                <DrawerContent className="flex min-h-0 flex-1 flex-col">
                  {(title || showClose) && (
                    <div className="mb-4 flex shrink-0 items-center justify-between">
                      {title && (
                        <DrawerTitle className="text-lg/6 font-medium text-text-primary">
                          {title}
                        </DrawerTitle>
                      )}
                      {showClose && (
                        <DrawerCloseButton
                          aria-label={t(($) => $['operation.close'], { ns: 'common' })}
                          className="size-6 rounded-md"
                        />
                      )}
                    </div>
                  )}
                  {children}
                </DrawerContent>
              </DrawerPopup>
            </DrawerViewport>
          </DrawerPortal>
        </Drawer>
      )}
      {!isMobile && isOpen && <>{children}</>}
    </>
  )
}

export default FloatRightContainer
