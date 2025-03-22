import type {
  FC,
  ReactNode,
} from 'react'
import {
  memo,
  useCallback,
  useState,
} from 'react'
import type { ChatItem } from '../types'
import type { Theme } from '../embedded-chatbot/theme/theme-context'
import { CssTransform } from '../embedded-chatbot/theme/utils'
import ContentSwitch from './content-switch'
import { User } from '@/app/components/base/icons/src/public/avatar'
import { Markdown } from '@/app/components/base/markdown'
import { FileList } from '@/app/components/base/file-uploader'
import ActionButton from '../../action-button'
import { RiClipboardLine, RiEditLine } from '@remixicon/react'
import Toast from '../../toast'
import copy from 'copy-to-clipboard'
import { useTranslation } from 'react-i18next'
import cn from '@/utils/classnames'
import Textarea from 'rc-textarea'
import Button from '../../button'
import { useChatContext } from './context'

type QuestionProps = {
  item: ChatItem
  questionIcon?: ReactNode
  theme: Theme | null | undefined
  switchSibling?: (siblingMessageId: string) => void
}

const Question: FC<QuestionProps> = ({
  item,
  questionIcon,
  theme,
  switchSibling,
}) => {
  const { t } = useTranslation()

  const {
    content,
    message_files,
  } = item

  const {
    onRegenerate,
  } = useChatContext()

  const [isEditing, setIsEditing] = useState(false)
  const [editedContent, setEditedContent] = useState(content)

  const handleEdit = useCallback(() => {
    setIsEditing(true)
    setEditedContent(content)
  }, [content])

  const handleResend = useCallback(() => {
    setIsEditing(false)
    onRegenerate?.(item, { message: editedContent, files: message_files })
  }, [editedContent, message_files, item, onRegenerate])

  const handleCancelEditing = useCallback(() => {
    setIsEditing(false)
    setEditedContent(content)
  }, [content])

  const handleSwitchSibling = useCallback((direction: 'prev' | 'next') => {
    if (direction === 'prev')
      item.prevSibling && switchSibling?.(item.prevSibling)
    else
      item.nextSibling && switchSibling?.(item.nextSibling)
  }, [switchSibling, item.prevSibling, item.nextSibling])

  return (
    <div className='flex justify-end mb-2 last:mb-0 pl-14'>
      <div className={cn('group relative flex items-start mr-4 max-w-full', isEditing && 'flex-1')}>
        <div className={cn('gap-1 mr-2', isEditing ? 'hidden' : 'flex')}>
          <div className="
            hidden group-hover:flex absolutegap-0.5 p-0.5 rounded-[10px]
            border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg shadow-md backdrop-blur-sm
          ">
            <ActionButton onClick={() => {
              copy(content)
              Toast.notify({ type: 'success', message: t('common.actionMsg.copySuccessfully') })
            }}>
              <RiClipboardLine className='w-4 h-4' />
            </ActionButton>
            <ActionButton onClick={handleEdit}>
              <RiEditLine className='w-4 h-4' />
            </ActionButton>
          </div>
        </div>
        <div
          className='w-full px-4 py-3 bg-[#D1E9FF]/50 rounded-2xl text-sm text-gray-900'
          style={theme?.chatBubbleColorStyle ? CssTransform(theme.chatBubbleColorStyle) : {}}
        >
          {
            !!message_files?.length && (
              <FileList
                className='mb-2'
                files={message_files}
                showDeleteAction={false}
                showDownloadAction={true}
              />
            )
          }
          { !isEditing
            ? <Markdown content={content} />
            : <div className="
                flex flex-col gap-2 p-[9px]
                bg-components-panel-bg-blur border border-components-chat-input-border rounded-xl shadow-md
              ">
              <div className="max-h-[158px] overflow-x-hidden overflow-y-auto">
                <Textarea
                  className={cn(
                    'p-1 w-full leading-6 body-lg-regular text-text-tertiary outline-none',
                  )}
                  autoFocus
                  autoSize={{ minRows: 1 }}
                  value={editedContent}
                  onChange={e => setEditedContent(e.target.value)}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant='ghost' onClick={handleCancelEditing}>{t('common.operation.cancel')}</Button>
                <Button variant='primary' onClick={handleResend}>{t('common.chat.resend')}</Button>
              </div>
            </div> }
          { !isEditing && <ContentSwitch
            count={item.siblingCount}
            currentIndex={item.siblingIndex}
            prevDisabled={!item.prevSibling}
            nextDisabled={!item.nextSibling}
            switchSibling={handleSwitchSibling}
          />}
        </div>
        <div className='mt-1 h-[18px]' />
      </div>
      <div className='shrink-0 w-10 h-10'>
        {
          questionIcon || (
            <div className='w-full h-full rounded-full border-[0.5px] border-black/5'>
              <User className='w-full h-full' />
            </div>
          )
        }
      </div>
    </div>
  )
}

export default memo(Question)
