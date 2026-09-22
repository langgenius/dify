import type { ConversationItem } from '@/models/share'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  DialogViewport,
} from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import InputsFormContent from '@/app/components/base/chat/chat-with-history/inputs-form/content'
import RenameModal from '@/app/components/base/chat/chat-with-history/sidebar/rename-modal'
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
  const isPin = pinnedConversationList.some((item) => item.id === currentConversationId)
  const [showConfirm, setShowConfirm] = useState<ConversationItem | null>(null)
  const [showRename, setShowRename] = useState<ConversationItem | null>(null)
  const handleOperate = useCallback(
    (type: string) => {
      if (type === 'pin') handlePinConversation(currentConversationId)

      if (type === 'unpin') handleUnpinConversation(currentConversationId)

      if (type === 'delete') setShowConfirm(currentConversationItem as any)

      if (type === 'rename') setShowRename(currentConversationItem as any)
    },
    [
      currentConversationId,
      currentConversationItem,
      handlePinConversation,
      handleUnpinConversation,
    ],
  )
  const handleCancelConfirm = useCallback(() => {
    setShowConfirm(null)
  }, [])
  const handleDelete = useCallback(() => {
    /* v8 ignore next 2 -- @preserve */
    if (showConfirm) handleDeleteConversation(showConfirm.id, { onSuccess: handleCancelConfirm })
  }, [showConfirm, handleDeleteConversation, handleCancelConfirm])
  const handleCancelRename = useCallback(() => {
    setShowRename(null)
  }, [])
  const handleRename = useCallback(
    (newName: string) => {
      /* v8 ignore next 2 -- @preserve */
      if (showRename)
        handleRenameConversation(showRename.id, newName, { onSuccess: handleCancelRename })
    },
    [showRename, handleRenameConversation, handleCancelRename],
  )
  const [showChatSettings, setShowChatSettings] = useState(false)

  return (
    <>
      <Dialog>
        <div className="flex shrink-0 items-center gap-1 bg-mask-top2bottom-gray-50-to-transparent px-2 py-3">
          <DialogTrigger
            render={
              <IconButton
                aria-label={t(($) => $['sidebar.expandSidebar'], { ns: 'layout' })}
                size="lg"
                className="shrink-0"
              >
                <div aria-hidden="true" className="i-ri-menu-line h-4.5 w-4.5" />
              </IconButton>
            }
          />
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
        <DialogPortal>
          <DialogBackdrop />
          <DialogViewport className="flex p-1">
            <DialogPopup className="flex h-full w-[calc(100vw-40px)] flex-col rounded-xl backdrop-blur-xs">
              <DialogTitle className="sr-only">
                {appData?.site.title || t(($) => $['sidebar.expandSidebar'], { ns: 'layout' })}
              </DialogTitle>
              <DialogClose
                render={
                  <IconButton
                    className="m-2 self-end"
                    aria-label={t(($) => $['operation.close'], { ns: 'common' })}
                  >
                    <span aria-hidden="true" className="i-ri-close-line size-4" />
                  </IconButton>
                }
              />
              <div className="flex min-h-0 flex-1">
                <Sidebar />
              </div>
            </DialogPopup>
          </DialogViewport>
        </DialogPortal>
      </Dialog>
      <Dialog open={showChatSettings} onOpenChange={setShowChatSettings}>
        <DialogPortal>
          <DialogBackdrop />
          <DialogViewport className="flex justify-end p-1">
            <DialogPopup className="flex h-full w-[calc(100vw-40px)] flex-col rounded-xl backdrop-blur-xs">
              <div className="flex items-center gap-3 rounded-t-2xl border-b border-divider-subtle px-4 py-3">
                <div
                  aria-hidden="true"
                  className="i-custom-public-other-message-3-fill size-6 shrink-0"
                />
                <DialogTitle className="grow system-xl-semibold text-text-secondary">
                  {t(($) => $['chat.chatSettingsTitle'], { ns: 'share' })}
                </DialogTitle>
                <DialogClose
                  render={
                    <IconButton aria-label={t(($) => $['operation.close'], { ns: 'common' })}>
                      <span aria-hidden="true" className="i-ri-close-line size-4" />
                    </IconButton>
                  }
                />
              </div>
              <div className="overflow-y-auto p-4">
                <InputsFormContent />
              </div>
            </DialogPopup>
          </DialogViewport>
        </DialogPortal>
      </Dialog>
      <AlertDialog open={!!showConfirm} onOpenChange={(open) => !open && handleCancelConfirm()}>
        <AlertDialogContent>
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
              {t(($) => $['chat.deleteConversation.title'], { ns: 'share' })}
            </AlertDialogTitle>
            <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
              {t(($) => $['chat.deleteConversation.content'], { ns: 'share' }) || ''}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton onClick={handleDelete}>
              {t(($) => $['operation.confirm'], { ns: 'common' })}
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
