import type { ConversationItem } from '@/models/share'
import { cn } from '@langgenius/dify-ui/cn'
import {
  RiEditBoxLine,
  RiExpandRightLine,
  RiLayoutLeft2Line,
} from '@remixicon/react'
import {
  useCallback,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import AppIcon from '@/app/components/base/app-icon'
import List from '@/app/components/base/chat/chat-with-history/sidebar/list'
import RenameModal from '@/app/components/base/chat/chat-with-history/sidebar/rename-modal'
import DifyLogo from '@/app/components/base/logo/dify-logo'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/app/components/base/ui/alert-dialog'
import { Button } from '@/app/components/base/ui/button'
import MenuDropdown from '@/app/components/share/text-generation/menu-dropdown'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useChatWithHistoryContext } from '../context'

type Props = {
  isPanel?: boolean
  panelVisible?: boolean
}

const Sidebar = ({ isPanel, panelVisible }: Props) => {
  const { t } = useTranslation()
  const {
    isInstalledApp,
    appData,
    handleNewConversation,
    pinnedConversationList,
    conversationList,
    currentConversationId,
    handleChangeConversation,
    handlePinConversation,
    handleUnpinConversation,
    conversationRenaming,
    handleRenameConversation,
    handleDeleteConversation,
    sidebarCollapseState,
    handleSidebarCollapse,
    isMobile,
    isResponding,
  } = useChatWithHistoryContext()
  const isSidebarCollapsed = sidebarCollapseState
  const systemFeatures = useGlobalPublicStore(s => s.systemFeatures)
  const [showConfirm, setShowConfirm] = useState<ConversationItem | null>(null)
  const [showRename, setShowRename] = useState<ConversationItem | null>(null)

  const handleOperate = useCallback((type: string, item: ConversationItem) => {
    if (type === 'pin')
      handlePinConversation(item.id)

    if (type === 'unpin')
      handleUnpinConversation(item.id)

    if (type === 'delete')
      setShowConfirm(item)

    if (type === 'rename')
      setShowRename(item)
  }, [handlePinConversation, handleUnpinConversation])
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
  const pinnedTitle = t('chat.pinnedTitle', { ns: 'share' }) || ''
  const deleteConversationContent = t('chat.deleteConversation.content', { ns: 'share' }) || ''

  return (
    <div className={cn(
      'flex w-full grow flex-col',
      isPanel && 'rounded-xl border-[0.5px] border-components-panel-border-subtle bg-components-panel-bg shadow-lg',
    )}
    >
      <div className={cn(
        'flex shrink-0 items-center gap-3 p-3 pr-2',
      )}
      >
        <div className="shrink-0">
          <AppIcon
            size="large"
            iconType={appData?.site.icon_type}
            icon={appData?.site.icon}
            background={appData?.site.icon_background}
            imageUrl={appData?.site.icon_url}
          />
        </div>
        <div className={cn('grow truncate system-md-semibold text-text-secondary')}>{appData?.site.title}</div>
        {!isMobile && isSidebarCollapsed && (
          <ActionButton size="l" onClick={() => handleSidebarCollapse(false)}>
            <RiExpandRightLine className="h-[18px] w-[18px]" />
          </ActionButton>
        )}
        {!isMobile && !isSidebarCollapsed && (
          <ActionButton size="l" onClick={() => handleSidebarCollapse(true)}>
            <RiLayoutLeft2Line className="h-[18px] w-[18px]" />
          </ActionButton>
        )}
      </div>
      <div className="shrink-0 px-3 py-4">
        <Button variant="secondary-accent" disabled={isResponding} className="w-full justify-center" onClick={handleNewConversation}>
          <RiEditBoxLine className="mr-1 h-4 w-4" />
          {t('chat.newChat', { ns: 'share' })}
        </Button>
      </div>
      <div className="h-0 grow space-y-2 overflow-y-auto px-3 pt-4">
        {/* pinned list */}
        {!!pinnedConversationList.length && (
          <div className="mb-4">
            <List
              isPin
              title={pinnedTitle}
              list={pinnedConversationList}
              onChangeConversation={handleChangeConversation}
              onOperate={handleOperate}
              currentConversationId={currentConversationId}
            />
          </div>
        )}
        {!!conversationList.length && (
          <List
            title={(pinnedConversationList.length && t('chat.unpinnedTitle', { ns: 'share' })) || ''}
            list={conversationList}
            onChangeConversation={handleChangeConversation}
            onOperate={handleOperate}
            currentConversationId={currentConversationId}
          />
        )}
      </div>
      <div className="flex shrink-0 items-center justify-between p-3">
        <MenuDropdown
          hideLogout={isInstalledApp}
          placement="top-start"
          data={appData?.site}
          forceClose={isPanel && !panelVisible}
        />
        {/* powered by */}
        <div className="shrink-0">
          {!appData?.custom_config?.remove_webapp_brand && (
            <div className={cn(
              'flex shrink-0 items-center gap-1.5 px-1',
            )}
            >
              <div className="system-2xs-medium-uppercase text-text-tertiary">{t('chat.poweredBy', { ns: 'share' })}</div>
              {
                systemFeatures.branding.enabled && systemFeatures.branding.workspace_logo
                  ? <img src={systemFeatures.branding.workspace_logo} alt="logo" className="block h-5 w-auto" />
                  : appData?.custom_config?.replace_webapp_logo
                    ? <img src={`${appData?.custom_config?.replace_webapp_logo}`} alt="logo" className="block h-5 w-auto" />
                    : <DifyLogo size="small" />
              }
            </div>
          )}
        </div>
        <AlertDialog open={!!showConfirm} onOpenChange={open => !open && handleCancelConfirm()}>
          <AlertDialogContent>
            <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
              <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
                {t('chat.deleteConversation.title', { ns: 'share' })}
              </AlertDialogTitle>
              <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
                {deleteConversationContent}
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
      </div>
    </div>
  )
}

export default Sidebar
