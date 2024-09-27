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
      {/* 当前会话：{title}<br /> */}
      
      <p style={{ color: '#155eef' }}>示例：<br />
      <div style={{ border: '1px solid gray', fontWeight: 'normal', display: 'block' , margin: '0', padding: '4px' }}>
        请生成开学季，有关防晒的科普文案
      </div>
      <div style={{ border: '1px solid gray', fontWeight: 'normal', display: 'block' , margin: '0', padding: '4px' }}>
        生成给宝宝洗澡时的种草文案，仔细描述洗澡的心得或感受
      </div>
      <div style={{ border: '1px solid gray', fontWeight: 'normal', display: 'block' , margin: '0', padding: '4px' }}>
        生成给宝宝洗脸时的种草文案，仔细描述清洁的心得或感受
      </div>
      <div style={{ border: '1px solid gray', fontWeight: 'normal', display: 'block' , margin: '0', padding: '4px' }}>
        生成宝宝夏天睡觉太热的种草文案，仔细描述宝宝睡不着或者惊醒时妈妈的心得或感受
      </div>
      </p >
    </div>
  )
}

export default memo(Header)
