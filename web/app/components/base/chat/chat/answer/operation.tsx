import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChatItem } from '../../types'
import { useCurrentAnswerIsResponsing } from '../hooks'
import { useChatContext } from '../context'
import CopyBtn from '@/app/components/app/chat/copy-btn'
import { MessageFast } from '@/app/components/base/icons/src/vender/solid/communication'
import AudioBtn from '@/app/components/base/audio-btn'
import AnnotationCtrlBtn from '@/app/components/app/configuration/toolbox/annotation/annotation-ctrl-btn'
import EditReplyModal from '@/app/components/app/annotation/edit-annotation-modal'
import {
  ThumbsDown,
  ThumbsUp,
} from '@/app/components/base/icons/src/vender/line/alertsAndFeedback'
import TooltipPlus from '@/app/components/base/tooltip-plus'

type OperationProps = {
  item: ChatItem
  question: string
  index: number
}
const Operation: FC<OperationProps> = ({
  item,
  question,
  index,
}) => {
  const { t } = useTranslation()
  const {
    config,
    onAnnotationAdded,
    onAnnotationEdited,
    onAnnotationRemoved,
    onFeedback,
  } = useChatContext()
  const [isShowReplyModal, setIsShowReplyModal] = useState(false)
  const responsing = useCurrentAnswerIsResponsing(item.id)
  const {
    id,
    isOpeningStatement,
    content,
    annotation,
    feedback,
  } = item
  const hasAnnotation = !!annotation?.id
  const [localFeedback, setLocalFeedback] = useState(feedback)

  const handleFeedback = async (rating: 'like' | 'dislike' | null) => {
    if (!config?.supportFeedback || !onFeedback)
      return

    await onFeedback?.(id, { rating })
    setLocalFeedback({ rating })
  }

  return (
    <div className='absolute top-[-14px] right-[-14px] flex justify-end gap-1'>
      {
        !isOpeningStatement && !responsing && (
          <CopyBtn
            value={content}
            className='hidden group-hover:block'
          />
        )
      }
      {!isOpeningStatement && config?.text_to_speech && (
        <AudioBtn
          value={content}
          className='hidden group-hover:block'
        />
      )}
      {(!isOpeningStatement && config?.supportAnnotation && config.annotation_reply?.enabled) && (
        <AnnotationCtrlBtn
          appId={config?.appId || ''}
          messageId={id}
          annotationId={annotation?.id || ''}
          className='hidden group-hover:block ml-1 shrink-0'
          cached={hasAnnotation}
          query={question}
          answer={content}
          onAdded={(id, authorName) => onAnnotationAdded?.(id, authorName, question, content, index)}
          onEdit={() => setIsShowReplyModal(true)}
          onRemoved={() => onAnnotationRemoved?.(index)}
        />
      )}

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
      {
        annotation?.id && (
          <div
            className='relative box-border flex items-center justify-center h-7 w-7 p-0.5 rounded-lg bg-white cursor-pointer text-[#444CE7] shadow-md'
          >
            <div className='p-1 rounded-lg bg-[#EEF4FF] '>
              <MessageFast className='w-4 h-4' />
            </div>
          </div>
        )
      }
      {
        config?.supportFeedback && !localFeedback?.rating && onFeedback && !isOpeningStatement && (
          <div className='hidden group-hover:flex ml-1 shrink-0 items-center px-0.5 bg-white border-[0.5px] border-gray-100 shadow-md text-gray-500 rounded-lg'>
            <TooltipPlus popupContent={t('appDebug.operation.agree')}>
              <div
                className='flex items-center justify-center mr-0.5 w-6 h-6 rounded-md hover:bg-black/5 hover:text-gray-800 cursor-pointer'
                onClick={() => handleFeedback('like')}
              >
                <ThumbsUp className='w-4 h-4' />
              </div>
            </TooltipPlus>
            <TooltipPlus popupContent={t('appDebug.operation.disagree')}>
              <div
                className='flex items-center justify-center w-6 h-6 rounded-md hover:bg-black/5 hover:text-gray-800 cursor-pointer'
                onClick={() => handleFeedback('dislike')}
              >
                <ThumbsDown className='w-4 h-4' />
              </div>
            </TooltipPlus>
          </div>
        )
      }
      {
        config?.supportFeedback && localFeedback?.rating && onFeedback && !isOpeningStatement && (
          <TooltipPlus popupContent={localFeedback.rating === 'like' ? t('appDebug.operation.cancelAgree') : t('appDebug.operation.cancelDisagree')}>
            <div
              className={`
                flex items-center justify-center w-7 h-7 rounded-[10px] border-[2px] border-white cursor-pointer
                ${localFeedback.rating === 'like' && 'bg-blue-50 text-blue-600'}
                ${localFeedback.rating === 'dislike' && 'bg-red-100 text-red-600'}
              `}
              onClick={() => handleFeedback(null)}
            >
              {
                localFeedback.rating === 'like' && (
                  <ThumbsUp className='w-4 h-4' />
                )
              }
              {
                localFeedback.rating === 'dislike' && (
                  <ThumbsDown className='w-4 h-4' />
                )
              }
            </div>
          </TooltipPlus>
        )
      }
    </div>
  )
}

export default Operation
