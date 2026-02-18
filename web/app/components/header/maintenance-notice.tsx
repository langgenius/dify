import { useState } from 'react'
import { X } from '@/app/components/base/icons/src/vender/line/general'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { NOTICE_I18N } from '@/i18n-config/language'

const MaintenanceNotice = () => {
  const locale = useLanguage()

  const [showNotice, setShowNotice] = useState(() => localStorage.getItem('hide-maintenance-notice') !== '1')
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
    <div className="z-20 flex h-[38px] shrink-0 items-center border-[0.5px] border-b border-b-[#FEF0C7] bg-[#FFFAEB] px-4">
      <div className="mr-2 flex h-[22px] shrink-0 items-center rounded-xl bg-[#F79009] px-2 text-[11px] font-medium text-white">{titleByLocale[locale]}</div>
      {
        (NOTICE_I18N.href && NOTICE_I18N.href !== '#')
          ? <div className="grow cursor-pointer text-xs font-medium text-gray-700" onClick={handleJumpNotice}>{descByLocale[locale]}</div>
          : <div className="grow text-xs font-medium text-gray-700">{descByLocale[locale]}</div>
      }
      <X className="h-4 w-4 shrink-0 cursor-pointer text-gray-500" onClick={handleCloseNotice} />
    </div>
  )
}

export default MaintenanceNotice
