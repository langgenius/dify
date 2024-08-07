import { useTranslation } from 'react-i18next'
import { ChatBotSlim } from '@/app/components/base/icons/src/vender/line/communication'

const Empty = () => {
  const { t } = useTranslation()

  return (
    <div className='absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2'>
      <div className='flex justify-center mb-2'>
        <ChatBotSlim className='w-12 h-12 text-gray-300' />
      </div>
      <div className='w-[256px] text-center text-[13px] text-gray-400'>
        {t('workflow.common.previewPlaceholder')}
      </div>
    </div>
  )
}

export default Empty
