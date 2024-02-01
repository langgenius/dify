import { useTranslation } from 'react-i18next'
import { useChatWithHistoryContext } from '../context'
import List from './list'
import AppIcon from '@/app/components/base/app-icon'
import Button from '@/app/components/base/button'
import { Edit05 } from '@/app/components/base/icons/src/vender/line/general'

const Sidebar = () => {
  const { t } = useTranslation()
  const {
    appData,
    pinnedConversationList,
    conversationList,
    handleNewConversation,
  } = useChatWithHistoryContext()

  return (
    <div className='shrink-0 flex flex-col w-[240px] border-r border-r-gray-100'>
      <div className='shrink-0 flex p-4'>
        <AppIcon
          className='mr-3'
          size='small'
          icon={appData?.site.icon}
          background={appData?.site.icon_background}
        />
        <div className='py-1 text-base font-semibold text-gray-800'>
          {appData?.site.title}
        </div>
      </div>
      <div className='shrink-0 p-4'>
        <Button
          className='justify-start px-3 py-0 w-full h-9 text-sm font-medium text-primary-600'
          onClick={handleNewConversation}
        >
          <Edit05 className='mr-2 w-4 h-4' />
          {t('share.chat.newChat')}
        </Button>
      </div>
      <div className='grow px-4 py-2'>
        {
          !!pinnedConversationList.length && (
            <div className='mb-4'>
              <List
                title={t('share.chat.pinnedTitle') || ''}
                list={pinnedConversationList}
              />
            </div>
          )
        }
        {
          !!conversationList.length && (
            <List
              title={(pinnedConversationList.length && t('share.chat.unpinnedTitle')) || ''}
              list={conversationList}
            />
          )
        }
      </div>
      <div className='px-4 pb-4 text-xs text-gray-400'>
        © {appData?.site.copyright || appData?.site.title} {(new Date()).getFullYear()}
      </div>
    </div>
  )
}

export default Sidebar
