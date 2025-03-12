import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiMenuLine,
} from '@remixicon/react'
import { useChatWithHistoryContext } from './context'
import Operation from './header/operation'
import Sidebar from './sidebar'
import MobileOperationDropdown from './header/mobile-operation-dropdown'
import AppIcon from '@/app/components/base/app-icon'
import ActionButton from '@/app/components/base/action-button'
import { Message3Fill } from '@/app/components/base/icons/src/public/other'
import InputsFormContent from '@/app/components/base/chat/chat-with-history/inputs-form/content'
import Confirm from '@/app/components/base/confirm'
import RenameModal from '@/app/components/base/chat/chat-with-history/sidebar/rename-modal'
import type { ConversationItem } from '@/models/share'

const HeaderInMobile = () => {
  const {
    appData,
    currentConversationId,
    currentConversationItem,
    pinnedConversationList,
    handleNewConversation,
    handlePinConversation,
    handleUnpinConversation,
    handleDeleteConversation,
    handleRenameConversation,
    conversationRenaming,
  } = useChatWithHistoryContext()
  const { t } = useTranslation()
  const isPin = pinnedConversationList.some(item => item.id === currentConversationId)
  const [showConfirm, setShowConfirm] = useState<ConversationItem | null>(null)
  const [showRename, setShowRename] = useState<ConversationItem | null>(null)
  const handleOperate = useCallback((type: string) => {
    if (type === 'pin')
      handlePinConversation(currentConversationId)

    if (type === 'unpin')
      handleUnpinConversation(currentConversationId)

    if (type === 'delete')
      setShowConfirm(currentConversationItem as any)

    if (type === 'rename')
      setShowRename(currentConversationItem as any)
  }, [currentConversationId, currentConversationItem, handlePinConversation, handleUnpinConversation])
  const handleCancelConfirm = useCallback(() => {
    setShowConfirm(null)
  }, [])
  const handleDelete = useCallback(() => {
    if (showConfirm)
      handleDeleteConversation(showConfirm.id, { onSuccess: handleCancelConfirm })
  }, [showConfirm, handleDeleteConversation, handleCancelConfirm])
  const handleCancelRename = useCallback(() => {
    setShowRename(null)
  }, [])
  const handleRename = useCallback((newName: string) => {
    if (showRename)
      handleRenameConversation(showRename.id, newName, { onSuccess: handleCancelRename })
  }, [showRename, handleRenameConversation, handleCancelRename])
  const [showSidebar, setShowSidebar] = useState(false)
  const [showChatSettings, setShowChatSettings] = useState(false)

  return (
    <>
      <div className='shrink-0 flex items-center px-2 py-3 gap-1 bg-mask-top2bottom-gray-50-to-transparent'>
        <ActionButton size='l' className='shrink-0' onClick={() => setShowSidebar(true)}>
          <RiMenuLine className='w-[18px] h-[18px]' />
        </ActionButton>
        <div className='grow flex justify-center items-center'>
          {!currentConversationId && (
            <>
              <AppIcon
                className='mr-2'
                size='tiny'
                icon={appData?.site.icon}
                iconType={appData?.site.icon_type}
                imageUrl={appData?.site.icon_url}
                background={appData?.site.icon_background}
              />
              <div className='text-text-secondary system-md-semibold truncate'>
                {appData?.site.title}
              </div>
            </>
          )}
          {currentConversationId && (
            <Operation
              title={currentConversationItem?.name || ''}
              isPinned={!!isPin}
              togglePin={() => handleOperate(isPin ? 'unpin' : 'pin')}
              isShowDelete
              isShowRenameConversation
              onRenameConversation={() => handleOperate('rename')}
              onDelete={() => handleOperate('delete')}
            />
          )}
        </div>
        <MobileOperationDropdown
          handleResetChat={handleNewConversation}
          handleViewChatSettings={() => setShowChatSettings(true)}
        />
      </div>
      {showSidebar && (
        <div className='fixed inset-0 z-50 flex p-1 bg-background-overlay'
          onClick={() => setShowSidebar(false)}
        >
          <div className='flex h-full w-[calc(100vw_-_40px)] bg-components-panel-bg backdrop-blur-sm rounded-xl shadow-lg' onClick={e => e.stopPropagation()}>
            <Sidebar />
          </div>
        </div>
      )}
      {showChatSettings && (
        <div className='fixed inset-0 z-50 flex justify-end p-1 bg-background-overlay'
          onClick={() => setShowChatSettings(false)}
        >
          <div className='flex flex-col h-full w-[calc(100vw_-_40px)] bg-components-panel-bg backdrop-blur-sm rounded-xl shadow-lg' onClick={e => e.stopPropagation()}>
            <div className='flex items-center gap-3 px-4 py-3 rounded-t-2xl border-b border-divider-subtle'>
              <Message3Fill className='shrink-0 w-6 h-6' />
              <div className='grow text-text-secondary system-xl-semibold'>{t('share.chat.chatSettingsTitle')}</div>
            </div>
            <div className='p-4'>
              <InputsFormContent showTip />
            </div>
          </div>
        </div>
      )}
      {!!showConfirm && (
        <Confirm
          title={t('share.chat.deleteConversation.title')}
          content={t('share.chat.deleteConversation.content') || ''}
          isShow
          onCancel={handleCancelConfirm}
          onConfirm={handleDelete}
        />
      )}
      {showRename && (
        <RenameModal
          isShow
          onClose={handleCancelRename}
          saveLoading={conversationRenaming}
          name={showRename?.name || ''}
          onSave={handleRename}
        />
      )}
    </>
  )
}

export default HeaderInMobile
