'use client'

import type { ReactNode } from 'react'
import { usePluginPageContext } from '@/app/components/plugins/plugin-page/context'
import cn from '@/utils/classnames'

type ListWrapperProps = {
  children: ReactNode
}
const ListWrapper = ({
  children,
}: ListWrapperProps) => {
  const scrollDisabled = usePluginPageContext(v => v.scrollDisabled)
  const setScrollDisabled = usePluginPageContext(v => v.setScrollDisabled)

  return (
    <>
      {
        scrollDisabled && (
          <div className='h-[60px]'></div>
        )
      }
      <div
        className={cn(
          'px-12 py-2 bg-background-default-subtle',
          scrollDisabled && 'grow h-0 overflow-y-auto',
        )}
        onScroll={(e) => {
          if ((e.target as HTMLElement).scrollTop <= 0)
            setScrollDisabled(false)
        }}
      >
        {children}
      </div>
    </>
  )
}

export default ListWrapper
