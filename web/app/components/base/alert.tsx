import {
  RiCloseLine,
  RiInformation2Fill,
} from '@remixicon/react'
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
        <div className={cn('pointer-events-none absolute inset-0 bg-gradient-to-r  opacity-[0.4]', bgVariants({ type }))}>
        </div>
        <div className="flex h-6 w-6 items-center justify-center">
          <RiInformation2Fill className="text-text-accent" />
        </div>
        <div className="p-1">
          <div className="system-xs-regular text-text-secondary">
            {message}
          </div>
        </div>
        <div
          className="pointer-events-auto flex h-6 w-6 cursor-pointer items-center justify-center"
          onClick={onHide}
        >
          <RiCloseLine className="h-4 w-4 text-text-tertiary" />
        </div>
      </div>
    </div>
  )
}

export default memo(Alert)
