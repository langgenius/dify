import { useState } from 'react'
import { useContext } from 'use-context-selector'
import I18n from '@/context/i18n'
import { X } from '@/app/components/base/icons/src/vender/line/general'

const NOTICE_I18N = {
  title: {
    'en': 'Important Notice',
    'zh-Hans': '重要公告',
  },
  desc: {
    'en': 'Our system will be unavailable from 19:00 to 24:00 UTC on August 28 for an upgrade. For questions, kindly contact our support team (support@dify.ai). We value your patience.',
    'zh-Hans': '为了有效提升数据检索能力及稳定性，Dify 将于 2023 年 8 月 29 日 03:00 至 08:00 期间进行服务升级，届时 Dify 云端版及应用将无法访问。感谢您的耐心与支持。',
  },
}

const MaintenanceNotice = () => {
  const { locale } = useContext(I18n)
  const [showNotice, setShowNotice] = useState(localStorage.getItem('hide-maintenance-notice') !== '1')

  const handleCloseNotice = () => {
    localStorage.setItem('hide-maintenance-notice', '1')
    setShowNotice(false)
  }

  if (!showNotice)
    return null

  return (
    <div className='shrink-0 flex items-center px-4 h-[38px] bg-[#FFFAEB] border-b border-[0.5px] border-b-[#FEF0C7] z-20'>
      <div className='shrink-0 flex items-center mr-2 px-2 h-[22px] bg-[#F79009] text-white text-[11px] font-medium rounded-xl'>{NOTICE_I18N.title[locale]}</div>
      <div className='grow text-xs font-medium text-gray-700'>{NOTICE_I18N.desc[locale]}</div>
      <X className='shrink-0 w-4 h-4 text-gray-500 cursor-pointer' onClick={handleCloseNotice} />
    </div>
  )
}

export default MaintenanceNotice
