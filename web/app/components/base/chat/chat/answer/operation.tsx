import type { FC } from 'react'
import {
  memo,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import type { ChatItem } from '../../types'
import { useChatContext } from '../context'
import RegenerateBtn from '@/app/components/base/regenerate-btn'
import cn from '@/utils/classnames'
import CopyBtn from '@/app/components/base/copy-btn'
import { MessageFast } from '@/app/components/base/icons/src/vender/solid/communication'
import AudioBtn from '@/app/components/base/audio-btn'
import AnnotationCtrlBtn from '@/app/components/base/features/new-feature-panel/annotation-reply/annotation-ctrl-btn'
import EditReplyModal from '@/app/components/app/annotation/edit-annotation-modal'
import {
  ThumbsDown,
  ThumbsUp,
} from '@/app/components/base/icons/src/vender/line/alertsAndFeedback'
import Tooltip from '@/app/components/base/tooltip'
import Log from '@/app/components/base/chat/chat/log'

interface OperationProps {
  item: ChatItem
  question: string
  index: number
  showPromptLog?: boolean
  maxSize: number
  contentWidth: number
  hasWorkflowProcess: boolean
  noChatInput?: boolean
}
const Operation: FC<OperationProps> = ({
  item,
  question,
  index,
  showPromptLog,
  maxSize,
  contentWidth,
  hasWorkflowProcess,
  noChatInput,
}) => {
  const { t } = useTranslation()
  const {
    config,
    onAnnotationAdded,
    onAnnotationEdited,
    onAnnotationRemoved,
    onFeedback,
    onRegenerate,
  } = useChatContext()
  const [isShowReplyModal, setIsShowReplyModal] = useState(false)
  const {
    id,
    isOpeningStatement,
    content: messageContent,
    annotation,
    feedback,
    adminFeedback,
    agent_thoughts,
  } = item
  const hasAnnotation = !!annotation?.id
  const [localFeedback, setLocalFeedback] = useState(config?.supportAnnotation ? adminFeedback : feedback)

  const content = useMemo(() => {
    if (agent_thoughts?.length)
      return agent_thoughts.reduce((acc, cur) => acc + cur.thought, '')

    return messageContent
  }, [agent_thoughts, messageContent])

  const handleFeedback = async (rating: 'like' | 'dislike' | null) => {
    if (!config?.supportFeedback || !onFeedback)
      return

    await onFeedback?.(id, { rating })
    setLocalFeedback({ rating })
  }

  const operationWidth = useMemo(() => {
    let width = 0
    if (!isOpeningStatement)
      width += 28
    if (!isOpeningStatement && showPromptLog)
      width += 102 + 8
    if (!isOpeningStatement && config?.text_to_speech?.enabled)
      width += 33
    if (!isOpeningStatement && config?.supportAnnotation && config?.annotation_reply?.enabled)
      width += 56 + 8
    if (config?.supportFeedback && !localFeedback?.rating && onFeedback && !isOpeningStatement)
      width += 60 + 8
    if (config?.supportFeedback && localFeedback?.rating && onFeedback && !isOpeningStatement)
      width += 28 + 8
    return width
  }, [isOpeningStatement, showPromptLog, config?.text_to_speech?.enabled, config?.supportAnnotation, config?.annotation_reply?.enabled, config?.supportFeedback, localFeedback?.rating, onFeedback])

  const positionRight = useMemo(() => operationWidth < maxSize, [operationWidth, maxSize])

  return (
    <>
      <div
        className={cn(
          'absolute flex justify-end gap-1',
          hasWorkflowProcess && '-right-3.5 -top-3.5',
          !positionRight && '-right-3.5 -top-3.5',
          !hasWorkflowProcess && positionRight && '!top-[9px]',
        )}
        style={(!hasWorkflowProcess && positionRight) ? { left: contentWidth + 8 } : {}}
      >
        {!isOpeningStatement && (
          <CopyBtn
            value={content}
            className='hidden group-hover:block'
          />
        )}

        {!isOpeningStatement && (showPromptLog || config?.text_to_speech?.enabled) && (
          <div className='hidden h-[28px] w-max shrink-0 items-center rounded-lg border-[0.5px] border-gray-100 bg-white p-0.5 shadow-md group-hover:flex'>
            {showPromptLog && (
              <>
                <Log logItem={item} />
                <div className='mx-1 h-[14px] w-[1px] bg-gray-200' />
              </>
            )}

            {(config?.text_to_speech?.enabled) && (
              <>
                <AudioBtn
                  id={id}
                  value={content}
                  noCache={false}
                  voice={config?.text_to_speech?.voice}
                  className='hidden group-hover:block'
                />
              </>
            )}
          </div>
        )}

        {(!isOpeningStatement && config?.supportAnnotation && config.annotation_reply?.enabled) && (
          <AnnotationCtrlBtn
            appId={config?.appId || ''}
            messageId={id}
            annotationId={annotation?.id || ''}
            className='ml-1 hidden shrink-0 group-hover:block'
            cached={hasAnnotation}
            query={question}
            answer={content}
            onAdded={(id, authorName) => onAnnotationAdded?.(id, authorName, question, content, index)}
            onEdit={() => setIsShowReplyModal(true)}
            onRemoved={() => onAnnotationRemoved?.(index)}
          />
        )}
        {
          annotation?.id && (
            <div
              className='relative box-border flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg bg-white p-0.5 text-[#444CE7] shadow-md group-hover:hidden'
            >
              <div className='rounded-lg bg-[#EEF4FF] p-1 '>
                <MessageFast className='h-4 w-4' />
              </div>
            </div>
          )
        }
        {
          !isOpeningStatement && !noChatInput && <RegenerateBtn className='mr-1 hidden group-hover:block' onClick={() => onRegenerate?.(item)} />
        }
        {
          config?.supportFeedback && !localFeedback?.rating && onFeedback && !isOpeningStatement && (
            <div className='hidden shrink-0 items-center rounded-lg border-[0.5px] border-gray-100 bg-white px-0.5 text-gray-500 shadow-md group-hover:flex'>
              <Tooltip popupContent={t('appDebug.operation.agree')}>
                <div
                  className='mr-0.5 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md hover:bg-black/5 hover:text-gray-800'
                  onClick={() => handleFeedback('like')}
                >
                  <ThumbsUp className='h-4 w-4' />
                </div>
              </Tooltip>
              <Tooltip
                popupContent={t('appDebug.operation.disagree')}
              >
                <div
                  className='flex h-6 w-6 cursor-pointer items-center justify-center rounded-md hover:bg-black/5 hover:text-gray-800'
                  onClick={() => handleFeedback('dislike')}
                >
                  <ThumbsDown className='h-4 w-4' />
                </div>
              </Tooltip>
            </div>
          )
        }
        {
          config?.supportFeedback && localFeedback?.rating && onFeedback && !isOpeningStatement && (
            <Tooltip
              popupContent={localFeedback.rating === 'like' ? t('appDebug.operation.cancelAgree') : t('appDebug.operation.cancelDisagree')}
            >
              <div
                className={`
                  flex h-7 w-7 cursor-pointer items-center justify-center rounded-[10px] border-[2px] border-white
                  ${localFeedback.rating === 'like' && 'bg-blue-50 text-blue-600'}
                  ${localFeedback.rating === 'dislike' && 'bg-red-100 text-red-600'}
                `}
                onClick={() => handleFeedback(null)}
              >
                {
                  localFeedback.rating === 'like' && (
                    <ThumbsUp className='h-4 w-4' />
                  )
                }
                {
                  localFeedback.rating === 'dislike' && (
                    <ThumbsDown className='h-4 w-4' />
                  )
                }
              </div>
            </Tooltip>
          )
        }
      </div>
      <EditReplyModal
        isShow={isShowReplyModal}
        onHide={() => setIsShowReplyModal(false)}
        query={question}
        answer={content}
        onEdited={(editedQuery, editedAnswer) => onAnnotationEdited?.(editedQuery, editedAnswer, index)}
        onAdded={(annotationId, authorName, editedQuery, editedAnswer) => onAnnotationAdded?.(annotationId, authorName, editedQuery, editedAnswer, index)}
        appId={config?.appId || ''}
        messageId={id}
        annotationId={annotation?.id || ''}
        createdAt={annotation?.created_at}
        onRemove={() => onAnnotationRemoved?.(index)}
      />
    </>
  )
}

export default memo(Operation)
