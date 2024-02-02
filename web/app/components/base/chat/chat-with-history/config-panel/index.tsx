import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useChatWithHistoryContext } from '../context'
import Form from './form'
import Button from '@/app/components/base/button'
import { MessageDotsCircle } from '@/app/components/base/icons/src/vender/solid/communication'
import { Edit02 } from '@/app/components/base/icons/src/vender/line/general'
import { Star06 } from '@/app/components/base/icons/src/vender/solid/shapes'

const ConfigPanel = () => {
  const { t } = useTranslation()
  const {
    appData,
    inputsForms,
    handleStartChat,
    showConfigPanelBeforeChat,
  } = useChatWithHistoryContext()
  const [collapsed, setCollapsed] = useState(true)

  return (
    <div
      className={`
        max-h-[80%] w-full max-w-[720px] rounded-xl overflow-y-auto
        ${showConfigPanelBeforeChat && 'border-[0.5px] border-gray-100 shadow-lg'}
        ${!showConfigPanelBeforeChat && collapsed && 'border border-indigo-100'}
        ${!showConfigPanelBeforeChat && !collapsed && 'border-[0.5px] border-gray-100 shadow-lg'}
      `}
    >
      <div
        className={`
          flex px-6 py-4 rounded-t-xl bg-indigo-25
        `}
      >
        {
          showConfigPanelBeforeChat && (
            <div className='text-2xl font-semibold text-gray-800'>{appData?.site.title}</div>
          )
        }
        {
          !showConfigPanelBeforeChat && collapsed && (
            <>
              <Star06 className='mr-1 mt-1 w-4 h-4 text-indigo-600' />
              <div className='grow py-[3px] text-[13px] text-indigo-600 leading-[18px] font-medium'>
                {t('share.chat.configStatusDes')}
              </div>
              <Button
                className='px-2 py-0 h-6 bg-white text-xs font-medium text-primary-600 rounded-md'
                onClick={() => setCollapsed(false)}
              >
                <Edit02 className='mr-1 w-3 h-3' />
                {t('common.operation.edit')}
              </Button>
            </>
          )
        }
        {
          !showConfigPanelBeforeChat && !collapsed && (
            <>
              <Star06 className='mr-1 mt-1 w-4 h-4 text-indigo-600' />
              <div className='grow py-[3px] text-[13px] text-indigo-600 leading-[18px] font-medium'>
                {t('share.chat.privatePromptConfigTitle')}
              </div>
            </>
          )
        }
      </div>
      {
        !collapsed && !showConfigPanelBeforeChat && (
          <div className='p-6 rounded-b-xl'>
            <Form />
            <div className='pl-[136px] flex items-center'>
              <Button
                type='primary'
                className='mr-2 text-sm font-medium'
                onClick={handleStartChat}
              >
                {t('common.operation.save')}
              </Button>
              <Button
                className='text-sm font-medium'
                onClick={() => setCollapsed(true)}
              >
                {t('common.operation.cancel')}
              </Button>
            </div>
          </div>
        )
      }
      {
        showConfigPanelBeforeChat && (
          <div className='p-6 rounded-b-xl'>
            <Form />
            <Button
              className={`px-4 py-0 h-9 ${inputsForms.length && 'ml-[136px]'}`}
              type='primary'
              onClick={handleStartChat}
            >
              <MessageDotsCircle className='mr-2 w-4 h-4 text-white' />
              {t('share.chat.startChat')}
            </Button>
          </div>
        )
      }
    </div>
  )
}

export default ConfigPanel
