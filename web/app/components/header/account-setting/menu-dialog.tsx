import type { ReactNode } from 'react'
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  DialogViewport,
} from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useTranslation } from 'react-i18next'

type MenuDialogProps = {
  children: ReactNode
  title: string
  onClose: () => void
}

const MenuDialog = ({ children, title, onClose }: MenuDialogProps) => {
  const { t } = useTranslation()

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogPortal>
        <DialogBackdrop className="bg-transparent" />
        <DialogViewport>
          <DialogPopup className="pointer-events-none relative isolate h-full w-full scale-100 overflow-visible rounded-none border-none bg-transparent shadow-none transition-opacity data-ending-style:scale-100 data-starting-style:scale-100">
            <DialogTitle className="sr-only">{title}</DialogTitle>
            <div className="pointer-events-auto absolute top-6 right-6 z-10 flex shrink-0 flex-col items-center">
              <DialogClose
                render={
                  <IconButton
                    variant="tertiary"
                    size="xl"
                    aria-label={t(($) => $['operation.close'], { ns: 'common' })}
                  >
                    <span aria-hidden className="i-ri-close-line size-5" />
                  </IconButton>
                }
              />
              <div aria-hidden className="mt-1 system-2xs-medium-uppercase text-text-tertiary">
                ESC
              </div>
            </div>
            <div className="pointer-events-auto relative z-0 h-full w-full overflow-hidden bg-background-sidenav-bg backdrop-blur-md">
              {children}
            </div>
          </DialogPopup>
        </DialogViewport>
      </DialogPortal>
    </Dialog>
  )
}

export default MenuDialog
