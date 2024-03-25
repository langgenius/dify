import {
  memo,
  useRef,
} from 'react'
import { useKeyPress } from 'ahooks'
import { useTranslation } from 'react-i18next'
import ChatWrapper from './chat-wrapper'
import Button from '@/app/components/base/button'
import { RefreshCcw01 } from '@/app/components/base/icons/src/vender/line/arrows'

export type ChatWrapperRefType = {
  handleRestart: () => void
}
const DebugAndPreview = () => {
  const { t } = useTranslation()
  const chatRef = useRef({ handleRestart: () => {} })

  useKeyPress('shift.r', () => {
    chatRef.current.handleRestart()
  }, {
    exactMatch: true,
  })

  return (
    <div
      className={`
        flex flex-col w-[400px] rounded-l-2xl h-full border border-black/[0.02] shadow-xl
      `}
      style={{
        background: 'linear-gradient(156deg, rgba(242, 244, 247, 0.80) 0%, rgba(242, 244, 247, 0.00) 99.43%), var(--white, #FFF)',
      }}
    >
      <div className='shrink-0 flex items-center justify-between px-4 pt-3 pb-2 font-semibold text-gray-900'>
        {t('workflow.common.debugAndPreview').toLocaleUpperCase()}
        <Button
          className='pl-2.5 pr-[7px] h-8 bg-white border-[0.5px] border-gray-200 shadow-xs rounded-lg text-[13px] text-primary-600 font-semibold'
          onClick={() => chatRef.current.handleRestart()}
        >
          <RefreshCcw01 className='mr-1 w-3.5 h-3.5' />
          {t('common.operation.refresh')}
          <div className='ml-2 px-1 leading-[18px] rounded-md border border-gray-200 bg-gray-50 text-[11px] text-gray-500 font-medium'>Shift</div>
          <div className='ml-0.5 px-1 leading-[18px] rounded-md border border-gray-200 bg-gray-50 text-[11px] text-gray-500 font-medium'>R</div>
        </Button>
      </div>
      <div className='grow rounded-b-2xl overflow-y-auto'>
        <ChatWrapper ref={chatRef} />
      </div>
    </div>
  )
}

export default memo(DebugAndPreview)
