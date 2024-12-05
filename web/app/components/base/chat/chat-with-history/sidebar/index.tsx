import React, {
  useCallback,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useChatWithHistoryContext } from '../context'
import List from './list'
import AppIcon from '@/app/components/base/app-icon'
import Button from '@/app/components/base/button'
import { Edit05 } from '@/app/components/base/icons/src/vender/line/general'
import type { ConversationItem } from '@/models/share'
import Confirm from '@/app/components/base/confirm'
import RenameModal from '@/app/components/base/chat/chat-with-history/sidebar/rename-modal'

const Sidebar = () => {
  const { t } = useTranslation()
  const {
    appData,
    pinnedConversationList,
    conversationList,
    handleNewConversation,
    currentConversationId,
    handleChangeConversation,
    handlePinConversation,
    handleUnpinConversation,
    conversationRenaming,
    handleRenameConversation,
    handleDeleteConversation,
    isMobile,
  } = useChatWithHistoryContext()
  const [showConfirm, setShowConfirm] = useState<ConversationItem | null>(null)
  const [showRename, setShowRename] = useState<ConversationItem | null>(null)
  const [isCollapsed, setIsCollapsed] = useState(false)

  const CollapsedIcon = ({ isCollapsed, onClick }: { isCollapsed: boolean;onClick: React.MouseEventHandler }) => isCollapsed
    ? (
      <svg width="16" height="16" onClick={onClick} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="m1.34,14.2a0.8,0.8 0 1 1 0,-1.61l13.39,0a0.8,0.8 0 0 1 0,1.61l-13.39,0zm0.15,-3.31a0.8,0.8 0 0 1 -0.42,-0.7l0,-4.82a0.81,0.81 0 0 1 1.24,-0.67l3.75,2.41a0.81,0.81 0 0 1 0,1.35l-3.75,2.41a0.81,0.81 0 0 1 -0.43,0.13a0.8,0.8 0 0 1 -0.38,-0.1l0,0zm1.19,-2.18l1.46,-0.94l-1.46,-0.94l0,1.88zm5.62,1.47a0.8,0.8 0 0 1 0,-1.61l5.89,0a0.8,0.8 0 1 1 0,1.61l-5.89,0zm0,-3.21a0.8,0.8 0 0 1 0,-1.61l5.89,0a0.8,0.8 0 1 1 0,1.61l-5.89,0zm-6.96,-4.02a0.8,0.8 0 1 1 0,-1.61l13.39,0a0.8,0.8 0 0 1 0,1.61l-13.39,0z" fill="#BEBEBE" />
      </svg>
    )
    : (
      <svg width="16" height="16" onClick={onClick} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="m1.08,14.64a0.82,0.82 0 1 1 0,-1.65l13.72,0a0.82,0.82 0 1 1 0,1.65l-13.72,0zm3.95,-3.42l-3.84,-2.47a0.82,0.82 0 0 1 0,-1.39l3.84,-2.47a0.8,0.8 0 0 1 0.44,-0.13a0.84,0.84 0 0 1 0.39,0.1a0.82,0.82 0 0 1 0.43,0.72l0,4.94a0.82,0.82 0 0 1 -0.43,0.72a0.83,0.83 0 0 1 -0.4,0.1a0.8,0.8 0 0 1 -0.44,-0.13l0,0zm-1.88,-3.16l1.49,0.96l0,-1.92l-1.49,0.96zm5.06,2.47a0.82,0.82 0 0 1 0,-1.65l6.04,0a0.82,0.82 0 0 1 0,1.65l-6.04,0zm0,-3.29a0.82,0.82 0 0 1 0,-1.65l6.04,0a0.82,0.82 0 0 1 0,1.65l-6.04,0zm-7.13,-4.12a0.82,0.82 0 1 1 0,-1.65l13.72,0a0.82,0.82 0 1 1 0,1.65l-13.72,0z" fill="#BEBEBE" />
      </svg>
    )

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
    <div className='shrink-0 h-full flex flex-col w-[240px] border-r border-r-gray-100'
      style={isCollapsed ? { width: '80px' } : {}}
    >
      {
        !isMobile && (
          <div className='shrink-0 flex p-4'>
            <AppIcon
              className='mr-3'
              size='small'
              iconType={appData?.site.icon_type}
              icon={appData?.site.icon}
              background={appData?.site.icon_background}
              imageUrl={appData?.site.icon_url}
            />
            {!isCollapsed && (
              <div className='py-1 text-base font-semibold text-gray-800'>
                {appData?.site.title}
              </div>
            )}
            <div className="flex items-center justify-end h-full ml-auto">
              <CollapsedIcon onClick={() => setIsCollapsed(!isCollapsed)} isCollapsed={isCollapsed} />
            </div>
          </div>
        )
      }
      <div className='shrink-0 p-4'>
        <Button
          variant='secondary-accent'
          className='justify-start w-full'
          onClick={handleNewConversation}
        >
          <Edit05 className='mr-2 w-4 h-4 flex-shrink-0' />
          <div className='overflow-hidden text-ellipsis whitespace-nowrap'>
            {t('share.chat.newChat')}
          </div>
        </Button>
      </div>
      <div className='grow px-4 py-2 overflow-y-auto'>
        {
          !!pinnedConversationList.length && (
            <div className='mb-4'>
              <List
                isCollapsed={isCollapsed}
                isPin
                title={t('share.chat.pinnedTitle') || ''}
                list={pinnedConversationList}
                onChangeConversation={handleChangeConversation}
                onOperate={handleOperate}
                currentConversationId={currentConversationId}
              />
            </div>
          )
        }
        {
          !!conversationList.length && (
            <List
              title={(pinnedConversationList.length && t('share.chat.unpinnedTitle')) || ''}
              list={conversationList}
              isCollapsed={isCollapsed}
              onChangeConversation={handleChangeConversation}
              onOperate={handleOperate}
              currentConversationId={currentConversationId}
            />
          )
        }
      </div>
      {!isCollapsed && (
        <div className="px-4 pb-4 text-xs text-gray-400">
          © {appData?.site.copyright || appData?.site.title} {(new Date()).getFullYear()}
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
    </div>
  )
}

export default Sidebar
