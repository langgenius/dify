import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import SettingsModal from './settings-modal'
import { FileSearch02 } from '@/app/components/base/icons/src/vender/solid/files'
import { Settings01 } from '@/app/components/base/icons/src/vender/line/general'

const Moderation = () => {
  const { t } = useTranslation()
  const [showSettings, setShowSettings] = useState(false)

  return (
    <>
      <div className='flex items-center px-3 h-12 bg-gray-50 rounded-xl'>
        <div className='flex items-center justify-center mr-1 w-6 h-6'>
          <FileSearch02 className='shrink-0 w-4 h-4 text-[#039855]' />
        </div>
        <div className='grow text-gray-800 font-semibold'>{t('appDebug.feature.moderation.title')}</div>
        <div className='shrink-0 flex items-center text-xs text-gray-500'>
          <div>OpenAI Moderation</div>
          <div className='mx-1'>·</div>
          <div>INPUT Content Enabled</div>
        </div>
        <div className='shrink-0 ml-4 mr-1 w-[1px] h-3.5 bg-gray-200'></div>
        <div
          className={`
            shrink-0 flex items-center px-3 h-7 cursor-pointer rounded-md
            text-xs text-gray-700 font-medium hover:bg-gray-200
          `}
          onClick={() => setShowSettings(true)}
        >
          <Settings01 className='mr-[5px] w-3.5 h-3.5' />
          {t('common.operation.settings')}
        </div>
      </div>
      {
        showSettings && (
          <SettingsModal
            onCancel={() => setShowSettings(false)}
          />
        )
      }
    </>
  )
}

export default Moderation
