import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { FileSearch02 } from '@/app/components/base/icons/src/vender/solid/files'
import { Settings01 } from '@/app/components/base/icons/src/vender/line/general'
import { useModalContext } from '@/context/modal-context'
import ConfigContext from '@/context/debug-configuration'

const Moderation = () => {
  const { t } = useTranslation()
  const { setShowModerationSettingModal } = useModalContext()
  const {
    moderationConfig,
    setModerationConfig,
  } = useContext(ConfigContext)

  const handleOpenModerationSettingModal = () => {
    setShowModerationSettingModal({
      moderationConfig,
      onSaveCallback: setModerationConfig,
    })
  }

  const renderInfo = () => {
    let prefix = ''
    let input = ''
    let output = ''
    if (moderationConfig.type === 'openai')
      prefix = t('appDebug.feature.moderation.modal.provider.openai')

    if (moderationConfig.type === 'keywords')
      prefix = t('appDebug.feature.moderation.modal.provider.keywords')

    if (moderationConfig.type === 'api_based')
      prefix = t('common.apiBasedExtension.selector.title')

    if (moderationConfig.configs?.inputs_configs?.enabled)
      input = t('appDebug.feature.moderation.inputEnabled')

    if (moderationConfig.configs?.outputs_configs?.enabled)
      output += t('appDebug.feature.moderation.outputEnabled')

    return `${prefix} · ${input} ${output}`
  }

  return (
    <>
      <div className='flex items-center px-3 py-2 bg-gray-50 rounded-xl'>
        <div className='flex items-center justify-center mr-1 w-6 h-6'>
          <FileSearch02 className='shrink-0 w-4 h-4 text-[#039855]' />
        </div>
        <div className='shrink-0 mr-2 whitespace-nowrap text-sm text-gray-800 font-semibold'>{t('appDebug.feature.moderation.title')}</div>
        <div className='grow flex items-center text-xs text-gray-500'>
          {renderInfo()}
        </div>
        <div className='shrink-0 ml-4 mr-1 w-[1px] h-3.5 bg-gray-200'></div>
        <div
          className={`
            shrink-0 flex items-center px-3 h-7 cursor-pointer rounded-md
            text-xs text-gray-700 font-medium hover:bg-gray-200
          `}
          onClick={handleOpenModerationSettingModal}
        >
          <Settings01 className='mr-[5px] w-3.5 h-3.5' />
          {t('common.operation.settings')}
        </div>
      </div>
    </>
  )
}

export default Moderation
