import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import ChatWrapper from './chat-wrapper'

const DebugAndPreview: FC = () => {
  const { t } = useTranslation()

  return (
    <div
      className='flex flex-col w-[400px] h-full rounded-l-2xl border border-black/[0.02] shadow-xl'
      style={{ background: 'linear-gradient(156deg, rgba(242, 244, 247, 0.80) 0%, rgba(242, 244, 247, 0.00) 99.43%), var(--white, #FFF)' }}
    >
      <div className='shrink-0 flex items-center justify-between px-4 pt-3 pb-2 font-semibold text-gray-900'>
        {t('workflow.common.debugAndPreview').toLocaleUpperCase()}
        <div className='h-8' />
      </div>
      <div className='grow rounded-b-2xl'>
        <ChatWrapper />
      </div>
    </div>
  )
}

export default DebugAndPreview
