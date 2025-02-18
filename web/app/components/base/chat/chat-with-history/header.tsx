import type { FC } from 'react'
import { memo } from 'react'

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
      className={`
      sticky top-0 z-10 flex h-16 items-center border-b-[0.5px] border-b-gray-100 bg-white/80 
      px-8 text-base font-medium text-gray-900 backdrop-blur-md
      ${isMobile && '!h-12'}
      `}
    >
      {title}
    </div>
  )
}

export default memo(Header)
