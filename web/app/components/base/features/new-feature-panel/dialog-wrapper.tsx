import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { useCallback } from 'react'

type DialogProps = {
  className?: string
  children: ReactNode
  show: boolean
  onClose?: () => void
  inWorkflow?: boolean
}

const DialogWrapper = ({
  className,
  children,
  show,
  onClose,
  inWorkflow = true,
}: DialogProps) => {
  const close = useCallback(() => onClose?.(), [onClose])
  return (
    <Dialog
      open={show}
      onOpenChange={(open) => {
        if (!open)
          close()
      }}
    >
      <DialogContent
        backdropClassName="bg-black/25"
        className="top-0 left-0 h-screen max-h-none w-screen max-w-none translate-x-0 translate-y-0 overflow-hidden rounded-none border-none bg-transparent p-0 shadow-none"
        popupProps={{
          onClick: close,
        }}
      >
        <div className={cn('flex h-full min-h-full w-full flex-col items-end justify-center pb-2', inWorkflow ? 'pt-[112px]' : 'pt-[64px] pr-2')} data-testid="dialog-layout-container">
          <div
            className={cn(
              'relative flex h-0 w-[420px] grow flex-col overflow-hidden border-components-panel-border bg-components-panel-bg-alt p-0 text-left align-middle shadow-xl transition-all',
              inWorkflow ? 'rounded-l-2xl border-t-[0.5px] border-b-[0.5px] border-l-[0.5px]' : 'rounded-2xl border-[0.5px]',
              className,
            )}
            onClick={e => e.stopPropagation()}
          >
            {children}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default DialogWrapper
