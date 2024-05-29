'use client'
import classNames from 'classnames'
import { usePathname } from 'next/navigation'
import s from './index.module.css'

type HeaderWrapperProps = {
  children: React.ReactNode
}

const HeaderWrapper = ({
  children,
}: HeaderWrapperProps) => {
  const pathname = usePathname()
  const isBordered = ['/apps', '/datasets', '/datasets/create', '/tools'].includes(pathname)

  return (
    <div className={classNames(
      'sticky top-0 left-0 right-0 z-20 flex flex-col bg-gray-100 grow-0 shrink-0 basis-auto min-h-[56px]',
      s.header,
      isBordered ? 'border-b border-gray-200' : '',
    )}
    >
      {children}
    </div>
  )
}
export default HeaderWrapper
