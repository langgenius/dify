'use client'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { usePathname } from '@/next/navigation'
import s from './index.module.css'

type HeaderWrapperProps = {
  children: React.ReactNode
}

const HeaderWrapper = ({
  children,
}: HeaderWrapperProps) => {
  const pathname = usePathname()
  const isBordered = ['/apps', '/datasets/create', '/tools'].includes(pathname)

  return (
    <div className={cn('sticky top-0 right-0 left-0 z-30 flex min-h-[56px] shrink-0 grow-0 basis-auto flex-col', s.header, isBordered ? 'border-b border-divider-regular' : '')}>
      {children}
    </div>
  )
}
export default HeaderWrapper
