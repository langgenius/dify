import type { ReactNode } from 'react'
import { ScrollArea } from '@/app/components/base/ui/scroll-area'
import { cn } from '@/utils/classnames'

type InspectScrollAreaProps = {
  children: ReactNode
  className?: string
  contentClassName?: string
  label?: string
}

export default function InspectScrollArea({
  children,
  className,
  contentClassName,
  label,
}: InspectScrollAreaProps) {
  return (
    <ScrollArea
      className={cn('h-full min-h-0', className)}
      label={label}
      slotClassNames={{
        viewport: 'overscroll-contain',
        content: cn('min-h-full', contentClassName),
      }}
    >
      {children}
    </ScrollArea>
  )
}
