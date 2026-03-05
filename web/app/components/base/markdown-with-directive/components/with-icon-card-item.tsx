import type { ReactNode } from 'react'
import type { WithIconCardItemProps } from './markdown-with-directive-schema'
import Image from 'next/image'

type WithIconItemProps = WithIconCardItemProps & {
  children?: ReactNode
}

function WithIconCardItem({ icon, children }: WithIconItemProps) {
  return (
    <div className="flex h-11 items-center space-x-3 rounded-lg bg-background-section px-2">
      <Image src={icon} className="!border-none object-contain" alt="icon" width={40} height={40} />
      <div className="w-0 grow text-text-secondary system-sm-medium [&_p]:!mb-0 [&_p]:flex [&_p]:h-11 [&_p]:w-full [&_p]:items-center [&_p]:truncate">
        {children}
      </div>
    </div>
  )
}

export default WithIconCardItem
