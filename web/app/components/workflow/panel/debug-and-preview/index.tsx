import {
  memo,
  useRef,
} from 'react'
import { useKeyPress } from 'ahooks'
import cn from 'classnames'
import { RiCloseLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import {
  useEdgesInteractions,
  useNodesInteractions,
  useWorkflowInteractions,
} from '../../hooks'
import ChatWrapper from './chat-wrapper'
import Button from '@/app/components/base/button'
import { RefreshCcw01 } from '@/app/components/base/icons/src/vender/line/arrows'

export type ChatWrapperRefType = {
  handleRestart: () => void
}
const DebugAndPreview = () => {
  const { t } = useTranslation()
  const chatRef = useRef({ handleRestart: () => { } })
  const { handleCancelDebugAndPreviewPanel } = useWorkflowInteractions()
  const { handleNodeCancelRunningStatus } = useNodesInteractions()
  const { handleEdgeCancelRunningStatus } = useEdgesInteractions()

  const handleRestartChat = () => {
    handleNodeCancelRunningStatus()
    handleEdgeCancelRunningStatus()
    chatRef.current.handleRestart()
  }

  useKeyPress('shift.r', () => {
    handleRestartChat()
  }, {
    exactMatch: true,
  })

  return (
    <div
      className={cn(
        'flex flex-col w-[400px] rounded-l-2xl h-full border border-black/2',
      )}
      style={{
        background: 'linear-gradient(156deg, rgba(242, 244, 247, 0.80) 0%, rgba(242, 244, 247, 0.00) 99.43%), var(--white, #FFF)',
      }}
    >
      <div className='shrink-0 flex items-center justify-between pl-4 pr-3 pt-3 pb-2 font-semibold text-gray-900'>
        {t('workflow.common.debugAndPreview').toLocaleUpperCase()}
        <div className='flex items-center'>
          <Button
            onClick={() => handleRestartChat()}
          >
            <RefreshCcw01 className='shrink-0 mr-1 w-3 h-3 text-gray-500' />
            <div
              className='grow truncate uppercase'
              title={t('common.operation.refresh') || ''}
            >
              {t('common.operation.refresh')}
            </div>
            <div className='shrink-0 ml-1 px-1 leading-[18px] rounded-md border border-gray-200 bg-gray-50 text-[11px] text-gray-500 font-medium'>Shift</div>
            <div className='shrink-0 ml-0.5 px-1 leading-[18px] rounded-md border border-gray-200 bg-gray-50 text-[11px] text-gray-500 font-medium'>R</div>
          </Button>
          <div className='mx-3 w-[1px] h-3.5 bg-gray-200'></div>
          <div
            className='flex items-center justify-center w-6 h-6 cursor-pointer'
            onClick={handleCancelDebugAndPreviewPanel}
          >
            <RiCloseLine className='w-4 h-4 text-gray-500' />
          </div>
        </div>
      </div>
      <div className='grow rounded-b-2xl overflow-y-auto'>
        <ChatWrapper ref={chatRef} />
      </div>
    </div>
  )
}

export default memo(DebugAndPreview)
