import type { FC } from 'react'
import { memo } from 'react'
import cn from 'classnames'

type HeaderProps = {
  title: string
  isMobile: boolean
}
const Header: FC<HeaderProps> = ({
  title,
  isMobile,
}) => {
  return (
    <div
      className={cn(`
      sticky top-0 flex items-center px-8 h-16 bg-white/80 text-base font-medium 
    text-gray-900 border-b-[0.5px] border-b-gray-100 backdrop-blur-md z-10`,
      isMobile && '!h-12')}
    >
      {title}
    </div>
  )
}

export default memo(Header)
