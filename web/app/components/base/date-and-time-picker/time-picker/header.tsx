import React from 'react'
import { useTranslation } from 'react-i18next'

const Header = () => {
  const { t } = useTranslation()

  return (
    <div className='flex flex-col border-b-[0.5px] border-divider-regular'>
      <div className='system-md-semibold flex items-center px-2 py-1.5 text-text-primary'>
        {t('time.title.pickTime')}
      </div>
    </div>
  )
}

export default React.memo(Header)
