import type { ReactNode } from 'react'
import type { WithIconCardItemProps } from './markdown-with-directive-schema'
import { cn } from '@langgenius/dify-ui/cn'

type WithIconItemProps = WithIconCardItemProps & {
  children?: ReactNode
  iconAlt?: string
}

function WithIconCardItem({ icon, children, className, iconAlt }: WithIconItemProps) {
  return (
    <div className={cn('flex h-11 items-center space-x-3 rounded-lg bg-background-section px-2', className)}>
      <img
        src={icon}
        className="border-none! object-contain"
        alt={iconAlt ?? ''}
        aria-hidden={iconAlt ? undefined : true}
        width={40}
        height={40}
      />
      <div className="min-w-0 grow overflow-hidden system-sm-medium text-text-secondary [&_p]:m-0! [&_p]:block [&_p]:w-full [&_p]:overflow-hidden [&_p]:text-ellipsis [&_p]:whitespace-nowrap">
        {children}
      </div>
    </div>
  )
}

export default WithIconCardItem
