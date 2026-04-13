import { useTranslation } from 'react-i18next'
import { ChatBotSlim } from '@/app/components/base/icons/src/vender/line/communication'

const Empty = () => {
  const { t } = useTranslation()

  return (
    <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
      <div className="mb-2 flex justify-center">
        <ChatBotSlim className="h-12 w-12 text-gray-300" />
      </div>
      <div className="w-[256px] text-center text-[13px] text-gray-400">
        {t('common.previewPlaceholder', { ns: 'workflow' })}
      </div>
    </div>
  )
}

export default Empty
