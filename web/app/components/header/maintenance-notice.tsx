import { useState } from 'react'
import { useContext } from 'use-context-selector'
import I18n from '@/context/i18n'
import { X } from '@/app/components/base/icons/src/vender/line/general'
import { NOTICE_I18N, getModelRuntimeSupported } from '@/utils/language'

const MaintenanceNotice = () => {
  const { locale } = useContext(I18n)
  const language = getModelRuntimeSupported(locale)

  const [showNotice, setShowNotice] = useState(localStorage.getItem('hide-maintenance-notice') !== '1')
  const handleJumpNotice = () => {
    window.open(NOTICE_I18N.href, '_blank')
  }

  const handleCloseNotice = () => {
    localStorage.setItem('hide-maintenance-notice', '1')
    setShowNotice(false)
  }

  const titleByLocale: { [key: string]: string } = NOTICE_I18N.title
  const descByLocale: { [key: string]: string } = NOTICE_I18N.desc

  if (!showNotice)
    return null

  return (
    <div className='shrink-0 flex items-center px-4 h-[38px] bg-[#FFFAEB] border-b border-[0.5px] border-b-[#FEF0C7] z-20'>
      <div className='shrink-0 flex items-center mr-2 px-2 h-[22px] bg-[#F79009] text-white text-[11px] font-medium rounded-xl'>{titleByLocale[language]}</div>
      {
        (NOTICE_I18N.href && NOTICE_I18N.href !== '#')
          ? <div className='grow text-xs font-medium text-gray-700 cursor-pointer' onClick={handleJumpNotice}>{descByLocale[language]}</div>
          : <div className='grow text-xs font-medium text-gray-700'>{descByLocale[language]}</div>
      }
      <X className='shrink-0 w-4 h-4 text-gray-500 cursor-pointer' onClick={handleCloseNotice} />
    </div>
  )
}

export default MaintenanceNotice
