'use client'

import type { ReactNode } from 'react'
import { usePluginPageContext } from '@/app/components/plugins/plugin-page/context'
import cn from '@/utils/classnames'

type HeaderWrapperProps = {
  children: ReactNode
}
const HeaderWrapper = ({
  children,
}: HeaderWrapperProps) => {
  const scrollDisabled = usePluginPageContext(v => v.scrollDisabled)

  return (
    <div
      className={cn(
        'py-10',
        scrollDisabled && 'absolute left-1/2 -translate-x-1/2  -top-[100px] pb-3',
      )}
    >
      {children}
    </div>
  )
}

export default HeaderWrapper
