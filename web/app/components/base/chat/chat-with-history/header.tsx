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
      sticky top-0 flex items-center px-8 h-18 bg-white-100 text-base font-bold 
      text-black border-b-[0.5px] border-b-gray-100 backdrop-blur-md z-10
      ${isMobile && '!h-12'}
      `}
    >
      <div>
        当前会话：{title}。下面是文案生成的一些提问示例：<br />
          1.请生成开学季，有关防晒的科普文案<br />
          2.生成给宝宝洗澡时的种草文案，仔细描述洗澡的心得或感受<br />
          3.生成给宝宝洗脸时的种草文案，仔细描述清洁的心得或感受<br />
          4.生成宝宝夏天睡觉太热的种草文案，仔细描述宝宝睡不着或者惊醒时妈妈的心得或感受<br />
      </div>
    </div>
  )
}

export default memo(Header)
