import type { ConversationItem } from '@/models/share'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import AppIcon from '@/app/components/base/app-icon'
import InputsFormContent from '@/app/components/base/chat/chat-with-history/inputs-form/content'
import RenameModal from '@/app/components/base/chat/chat-with-history/sidebar/rename-modal'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/app/components/base/ui/alert-dialog'
import { useChatWithHistoryContext } from './context'
import MobileOperationDropdown from './header/mobile-operation-dropdown'
import Operation from './header/operation'
import Sidebar from './sidebar'

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
    inputsForms,
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
    /* v8 ignore next 2 -- @preserve */
    if (showConfirm)
      handleDeleteConversation(showConfirm.id, { onSuccess: handleCancelConfirm })
  }, [showConfirm, handleDeleteConversation, handleCancelConfirm])
  const handleCancelRename = useCallback(() => {
    setShowRename(null)
  }, [])
  const handleRename = useCallback((newName: string) => {
    /* v8 ignore next 2 -- @preserve */
    if (showRename)
      handleRenameConversation(showRename.id, newName, { onSuccess: handleCancelRename })
  }, [showRename, handleRenameConversation, handleCancelRename])
  const [showSidebar, setShowSidebar] = useState(false)
  const [showChatSettings, setShowChatSettings] = useState(false)

  return (
    <>
      <div className="flex shrink-0 items-center gap-1 bg-mask-top2bottom-gray-50-to-transparent px-2 py-3">
        <ActionButton size="l" className="shrink-0" onClick={() => setShowSidebar(true)}>
          <div className="i-ri-menu-line h-[18px] w-[18px]" />
        </ActionButton>
        <div className="flex grow items-center justify-center">
          {!currentConversationId && (
            <>
              <AppIcon
                className="mr-2"
                size="tiny"
                icon={appData?.site.icon}
                iconType={appData?.site.icon_type}
                imageUrl={appData?.site.icon_url}
                background={appData?.site.icon_background}
              />
              <div className="truncate system-md-semibold text-text-secondary">
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
          hideViewChatSettings={inputsForms.length < 1}
        />
      </div>
      {showSidebar && (
        <div
          className="fixed inset-0 z-50 flex bg-background-overlay p-1"
          onClick={() => setShowSidebar(false)}
          data-testid="mobile-sidebar-overlay"
        >
          <div className="flex h-full w-[calc(100vw-40px)] rounded-xl bg-components-panel-bg shadow-lg backdrop-blur-xs" onClick={e => e.stopPropagation()} data-testid="sidebar-content">
            <Sidebar />
          </div>
        </div>
      )}
      {showChatSettings && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-background-overlay p-1"
          onClick={() => setShowChatSettings(false)}
          data-testid="mobile-chat-settings-overlay"
        >
          <div className="flex h-full w-[calc(100vw-40px)] flex-col rounded-xl bg-components-panel-bg shadow-lg backdrop-blur-xs" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 rounded-t-2xl border-b border-divider-subtle px-4 py-3">
              <div className="i-custom-public-other-message-3-fill h-6 w-6 shrink-0" />
              <div className="grow system-xl-semibold text-text-secondary">{t('chat.chatSettingsTitle', { ns: 'share' })}</div>
            </div>
            <div className="p-4">
              <InputsFormContent />
            </div>
          </div>
        </div>
      )}
      <AlertDialog open={!!showConfirm} onOpenChange={open => !open && handleCancelConfirm()}>
        <AlertDialogContent>
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
              {t('chat.deleteConversation.title', { ns: 'share' })}
            </AlertDialogTitle>
            <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
              {t('chat.deleteConversation.content', { ns: 'share' }) || ''}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton>{t('operation.cancel', { ns: 'common' })}</AlertDialogCancelButton>
            <AlertDialogConfirmButton onClick={handleDelete}>
              {t('operation.confirm', { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
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
