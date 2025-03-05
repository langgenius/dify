import {
  useCallback,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiEditBoxLine,
  RiExpandRightLine,
  RiLayoutLeft2Line,
} from '@remixicon/react'
import { useChatWithHistoryContext } from '../context'
import AppIcon from '@/app/components/base/app-icon'
import ActionButton from '@/app/components/base/action-button'
import Button from '@/app/components/base/button'
import List from '@/app/components/base/chat/chat-with-history/sidebar/list'
import MenuDropdown from '@/app/components/share/text-generation/menu-dropdown'
import Confirm from '@/app/components/base/confirm'
import RenameModal from '@/app/components/base/chat/chat-with-history/sidebar/rename-modal'
import LogoSite from '@/app/components/base/logo/logo-site'
import type { ConversationItem } from '@/models/share'
import cn from '@/utils/classnames'

type Props = {
  isPanel?: boolean
}

const Sidebar = ({ isPanel }: Props) => {
  const { t } = useTranslation()
  const {
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
  } = useChatWithHistoryContext()
  const isSidebarCollapsed = sidebarCollapseState

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

  return (
    <div className={cn(
      'grow flex flex-col',
      isPanel && 'rounded-xl bg-components-panel-bg border-[0.5px] border-components-panel-border-subtle shadow-lg',
    )}>
      <div className={cn(
        'shrink-0 flex items-center gap-3 p-3 pr-2',
      )}>
        <div className='shrink-0'>
          <AppIcon
            size='large'
            iconType={appData?.site.icon_type}
            icon={appData?.site.icon}
            background={appData?.site.icon_background}
            imageUrl={appData?.site.icon_url}
          />
        </div>
        <div className={cn('grow text-text-secondary system-md-semibold truncate')}>{appData?.site.title}</div>
        {!isMobile && isSidebarCollapsed && (
          <ActionButton size='l' onClick={() => handleSidebarCollapse(false)}>
            <RiExpandRightLine className='w-[18px] h-[18px]' />
          </ActionButton>
        )}
        {!isMobile && !isSidebarCollapsed && (
          <ActionButton size='l' onClick={() => handleSidebarCollapse(true)}>
            <RiLayoutLeft2Line className='w-[18px] h-[18px]' />
          </ActionButton>
        )}
      </div>
      <div className='shrink-0 px-3 py-4'>
        <Button variant='secondary-accent' className='w-full justify-center' onClick={handleNewConversation}>
          <RiEditBoxLine className='w-4 h-4 mr-1' />
          {t('share.chat.newChat')}
        </Button>
      </div>
      <div className='grow h-0 pt-4 px-3 space-y-2 overflow-y-auto'>
        {/* pinned list */}
        {!!pinnedConversationList.length && (
          <div className='mb-4'>
            <List
              isPin
              title={t('share.chat.pinnedTitle') || ''}
              list={pinnedConversationList}
              onChangeConversation={handleChangeConversation}
              onOperate={handleOperate}
              currentConversationId={currentConversationId}
            />
          </div>
        )}
        {!!conversationList.length && (
          <List
            title={(pinnedConversationList.length && t('share.chat.unpinnedTitle')) || ''}
            list={conversationList}
            onChangeConversation={handleChangeConversation}
            onOperate={handleOperate}
            currentConversationId={currentConversationId}
          />
        )}
      </div>
      <div className='shrink-0 p-3 flex items-center justify-between'>
        <MenuDropdown placement='top-start' data={appData?.site} />
        {/* powered by */}
        <div className='shrink-0'>
          {!appData?.custom_config?.remove_webapp_brand && (
            <div className={cn(
              'shrink-0 px-2 flex items-center gap-1.5',
            )}>
              <div className='text-text-tertiary system-2xs-medium-uppercase'>{t('share.chat.poweredBy')}</div>
              {appData?.custom_config?.replace_webapp_logo && (
                <img src={appData?.custom_config?.replace_webapp_logo} alt='logo' className='block w-auto h-5' />
              )}
              {!appData?.custom_config?.replace_webapp_logo && (
                <LogoSite className='!h-5' />
              )}
            </div>
          )}
        </div>
      </div>
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
    </div>
  )
}

export default Sidebar
