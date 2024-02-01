import type { FC } from 'react'
import { useState } from 'react'
import type { ChatItem } from '../../types'
import { useCurrentAnswerIsResponsing } from '../hooks'
import { useChatContext } from '../context'
import CopyBtn from '@/app/components/app/chat/copy-btn'
import { MessageFast } from '@/app/components/base/icons/src/vender/solid/communication'
import AudioBtn from '@/app/components/base/audio-btn'
import AnnotationCtrlBtn from '@/app/components/app/configuration/toolbox/annotation/annotation-ctrl-btn'
import EditReplyModal from '@/app/components/app/annotation/edit-annotation-modal'

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
  const {
    config,
    onAnnotationAdded,
    onAnnotationEdited,
    onAnnotationRemoved,
  } = useChatContext()
  const [isShowReplyModal, setIsShowReplyModal] = useState(false)
  const responsing = useCurrentAnswerIsResponsing(item.id)
  const {
    id,
    isOpeningStatement,
    content,
    annotation,
  } = item
  const hasAnnotation = !!annotation?.id

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
    </div>
  )
}

export default Operation
