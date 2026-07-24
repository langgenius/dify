import { cva } from 'class-variance-authority'
import {
  memo,
} from 'react'
import { cn } from '@/utils/classnames'

type Props = {
  type?: 'info'
  message: string
  onHide: () => void
  className?: string
}
const bgVariants = cva(
  '',
  {
    variants: {
      type: {
        info: 'from-components-badge-status-light-normal-halo to-background-gradient-mask-transparent',
      },
    },
  },
)
const Alert: React.FC<Props> = ({
  type = 'info',
  message,
  onHide,
  className,
}) => {
  return (
    <div className={cn('pointer-events-none w-full', className)}>
      <div
        className="relative flex space-x-1 overflow-hidden rounded-xl border border-components-panel-border bg-components-panel-bg-blur p-3 shadow-lg"
      >
        <div className={cn('pointer-events-none absolute inset-0 bg-gradient-to-r opacity-[0.4]', bgVariants({ type }))} data-testid="alert-gradient">
        </div>
        <div className="flex h-6 w-6 items-center justify-center">
          <span className="i-ri-information-2-fill text-text-accent" data-testid="info-icon" />
        </div>
        <div className="p-1">
          <div className="text-text-secondary system-xs-regular" data-testid="msg-container">
            {message}
          </div>
        </div>
        <div
          className="pointer-events-auto flex h-6 w-6 cursor-pointer items-center justify-center"
          onClick={onHide}
        >
          <span className="i-ri-close-line h-4 w-4 text-text-tertiary" data-testid="close-icon" />
        </div>
      </div>
    </div>
  )
}

export default memo(Alert)
