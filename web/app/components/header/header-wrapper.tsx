'use client'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { usePathname } from '@/next/navigation'
import s from './index.module.css'

type HeaderWrapperProps = {
  children: React.ReactNode
}

const HeaderWrapper = ({ children }: HeaderWrapperProps) => {
  const pathname = usePathname()
  const isBordered = ['/apps', '/snippets', '/datasets/create', '/tools'].includes(pathname)

  return (
    <div
      className={cn(
        'sticky inset-s-0 inset-e-0 top-0 z-30 flex min-h-14 shrink-0 grow-0 basis-auto flex-col',
        s.header,
        isBordered ? 'border-b border-divider-regular' : '',
      )}
    >
      {children}
    </div>
  )
}
export default HeaderWrapper
