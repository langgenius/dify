'use client'
import type { FC, ReactNode } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { UserCircleIcon } from '@heroicons/react/24/solid'
import cn from 'classnames'
import type { CitationItem, DisplayScene, FeedbackFunc, Feedbacktype, IChatItem, ThoughtItem } from '../type'
import OperationBtn from '../operation'
import LoadingAnim from '../loading-anim'
import { EditIconSolid, OpeningStatementIcon, RatingIcon } from '../icon-component'
import s from '../style.module.css'
import MoreInfo from '../more-info'
import CopyBtn from '../copy-btn'
import Thought from '../thought'
import Citation from '../citation'
import { randomString } from '@/utils'
import type { MessageRating } from '@/models/log'
import Tooltip from '@/app/components/base/tooltip'
import { Markdown } from '@/app/components/base/markdown'
import type { DataSet } from '@/models/datasets'
import AnnotationCtrlBtn from '@/app/components/app/configuration/toolbox/annotation/annotation-ctrl-btn'
import EditReplyModal from '@/app/components/app/annotation/edit-annotation-modal'
import { EditTitle } from '@/app/components/app/annotation/edit-annotation-modal/edit-item'
import { MessageFast } from '@/app/components/base/icons/src/vender/solid/communication'

const Divider: FC<{ name: string }> = ({ name }) => {
  const { t } = useTranslation()
  return <div className='flex items-center my-2'>
    <span className='text-xs text-gray-500 inline-flex items-center mr-2'>
      <EditIconSolid className='mr-1' />{t('appLog.detail.annotationTip', { user: name })}
    </span>
    <div className='h-[1px] bg-gray-200 flex-1'></div>
  </div>
}
const IconWrapper: FC<{ children: React.ReactNode | string }> = ({ children }) => {
  return <div className={'rounded-lg h-6 w-6 flex items-center justify-center hover:bg-gray-100'}>
    {children}
  </div>
}
export type IAnswerProps = {
  item: IChatItem
  feedbackDisabled: boolean
  isHideFeedbackEdit: boolean
  onFeedback?: FeedbackFunc
  displayScene: DisplayScene
  isResponsing?: boolean
  answerIcon?: ReactNode
  thoughts?: ThoughtItem[]
  citation?: CitationItem[]
  isThinking?: boolean
  dataSets?: DataSet[]
  isShowCitation?: boolean
  isShowCitationHitInfo?: boolean
  // Annotation props
  supportAnnotation?: boolean
  appId?: string
  question: string
  onAnnotationEdited?: (question: string, answer: string) => void
  onAnnotationAdded?: (annotationId: string, authorName: string, question: string, answer: string) => void
  onAnnotationRemoved?: () => void
}
// The component needs to maintain its own state to control whether to display input component
const Answer: FC<IAnswerProps> = ({
  item,
  feedbackDisabled = false,
  isHideFeedbackEdit = false,
  onFeedback,
  displayScene = 'web',
  isResponsing,
  answerIcon,
  thoughts,
  citation,
  isThinking,
  dataSets,
  isShowCitation,
  isShowCitationHitInfo = false,
  supportAnnotation,
  appId,
  question,
  onAnnotationEdited,
  onAnnotationAdded,
  onAnnotationRemoved,
}) => {
  const { id, content, more, feedback, adminFeedback, annotation } = item
  const hasAnnotation = !!annotation?.id
  const [showEdit, setShowEdit] = useState(false)
  const [loading, setLoading] = useState(false)
  // const [annotation, setAnnotation] = useState<Annotation | undefined | null>(initAnnotation)
  // const [inputValue, setInputValue] = useState<string>(initAnnotation?.content ?? '')
  const [localAdminFeedback, setLocalAdminFeedback] = useState<Feedbacktype | undefined | null>(adminFeedback)
  // const { userProfile } = useContext(AppContext)
  const { t } = useTranslation()

  const [isShowReplyModal, setIsShowReplyModal] = useState(false)

  /**
 * Render feedback results (distinguish between users and administrators)
 * User reviews cannot be cancelled in Console
 * @param rating feedback result
 * @param isUserFeedback Whether it is user's feedback
 * @param isWebScene Whether it is web scene
 * @returns comp
 */
  const renderFeedbackRating = (rating: MessageRating | undefined, isUserFeedback = true, isWebScene = true) => {
    if (!rating)
      return null

    const isLike = rating === 'like'
    const ratingIconClassname = isLike ? 'text-primary-600 bg-primary-100 hover:bg-primary-200' : 'text-red-600 bg-red-100 hover:bg-red-200'
    const UserSymbol = <UserCircleIcon className='absolute top-[-2px] left-[18px] w-3 h-3 rounded-lg text-gray-400 bg-white' />
    // The tooltip is always displayed, but the content is different for different scenarios.
    return (
      <Tooltip
        selector={`user-feedback-${randomString(16)}`}
        content={((isWebScene || (!isUserFeedback && !isWebScene)) ? isLike ? t('appDebug.operation.cancelAgree') : t('appDebug.operation.cancelDisagree') : (!isWebScene && isUserFeedback) ? `${t('appDebug.operation.userAction')}${isLike ? t('appDebug.operation.agree') : t('appDebug.operation.disagree')}` : '') as string}
      >
        <div
          className={`relative box-border flex items-center justify-center h-7 w-7 p-0.5 rounded-lg bg-white cursor-pointer text-gray-500 hover:text-gray-800 ${(!isWebScene && isUserFeedback) ? '!cursor-default' : ''}`}
          style={{ boxShadow: '0px 4px 6px -1px rgba(0, 0, 0, 0.1), 0px 2px 4px -2px rgba(0, 0, 0, 0.05)' }}
          {...((isWebScene || (!isUserFeedback && !isWebScene))
            ? {
              onClick: async () => {
                const res = await onFeedback?.(id, { rating: null })
                if (res && !isWebScene)
                  setLocalAdminFeedback({ rating: null })
              },
            }
            : {})}
        >
          <div className={`${ratingIconClassname} rounded-lg h-6 w-6 flex items-center justify-center`}>
            <RatingIcon isLike={isLike} />
          </div>
          {!isWebScene && isUserFeedback && UserSymbol}
        </div>
      </Tooltip>
    )
  }

  const renderHasAnnotationBtn = () => {
    return (
      <div
        className={cn(s.hasAnnotationBtn, 'relative box-border flex items-center justify-center h-7 w-7 p-0.5 rounded-lg bg-white cursor-pointer text-[#444CE7]')}
        style={{ boxShadow: '0px 4px 6px -1px rgba(0, 0, 0, 0.1), 0px 2px 4px -2px rgba(0, 0, 0, 0.05)' }}
      >
        <div className='p-1 rounded-lg bg-[#EEF4FF] '>
          <MessageFast className='w-4 h-4' />
        </div>
      </div>
    )
  }

  /**
   * Different scenarios have different operation items.
   * @param isWebScene  Whether it is web scene
   * @returns comp
   */
  const renderItemOperation = (isWebScene = true) => {
    const userOperation = () => {
      return feedback?.rating
        ? null
        : <div className='flex gap-1'>
          <Tooltip selector={`user-feedback-${randomString(16)}`} content={t('appLog.detail.operation.like') as string}>
            {OperationBtn({ innerContent: <IconWrapper><RatingIcon isLike={true} /></IconWrapper>, onClick: () => onFeedback?.(id, { rating: 'like' }) })}
          </Tooltip>
          <Tooltip selector={`user-feedback-${randomString(16)}`} content={t('appLog.detail.operation.dislike') as string}>
            {OperationBtn({ innerContent: <IconWrapper><RatingIcon isLike={false} /></IconWrapper>, onClick: () => onFeedback?.(id, { rating: 'dislike' }) })}
          </Tooltip>
        </div>
    }

    const adminOperation = () => {
      return <div className='flex gap-1'>
        {!localAdminFeedback?.rating && <>
          <Tooltip selector={`user-feedback-${randomString(16)}`} content={t('appLog.detail.operation.like') as string}>
            {OperationBtn({
              innerContent: <IconWrapper><RatingIcon isLike={true} /></IconWrapper>,
              onClick: async () => {
                const res = await onFeedback?.(id, { rating: 'like' })
                if (res)
                  setLocalAdminFeedback({ rating: 'like' })
              },
            })}
          </Tooltip>
          <Tooltip selector={`user-feedback-${randomString(16)}`} content={t('appLog.detail.operation.dislike') as string}>
            {OperationBtn({
              innerContent: <IconWrapper><RatingIcon isLike={false} /></IconWrapper>,
              onClick: async () => {
                const res = await onFeedback?.(id, { rating: 'dislike' })
                if (res)
                  setLocalAdminFeedback({ rating: 'dislike' })
              },
            })}
          </Tooltip>
        </>}
      </div>
    }

    return (
      <div className={`${s.itemOperation} flex gap-2`}>
        {isWebScene ? userOperation() : adminOperation()}
      </div>
    )
  }

  return (
    <div key={id}>
      <div className='flex items-start'>
        {
          answerIcon || (
            <div className={`${s.answerIcon} w-10 h-10 shrink-0`}>
              {isResponsing
                && <div className={s.typeingIcon}>
                  <LoadingAnim type='avatar' />
                </div>
              }
            </div>
          )
        }
        <div className={cn(s.answerWrapWrap, 'chat-answer-container group')}>
          <div className={`${s.answerWrap} ${showEdit ? 'w-full' : ''}`}>
            <div className={`${s.answer} relative text-sm text-gray-900`}>
              <div className={'ml-2 py-3 px-4 bg-gray-100 rounded-tr-2xl rounded-b-2xl'}>
                {item.isOpeningStatement && (
                  <div className='flex items-center mb-1 gap-1'>
                    <OpeningStatementIcon />
                    <div className='text-xs text-gray-500'>{t('appDebug.openingStatement.title')}</div>
                  </div>
                )}
                {(thoughts && thoughts.length > 0) && (
                  <Thought
                    list={thoughts || []}
                    isThinking={isThinking}
                    dataSets={dataSets}
                  />
                )}
                {(isResponsing && !content)
                  ? (
                    <div className='flex items-center justify-center w-6 h-5'>
                      <LoadingAnim type='text' />
                    </div>
                  )
                  : (
                    <div>
                      {annotation?.logAnnotation && (
                        <div className='mb-1'>
                          <div className='mb-3'>
                            <Markdown className='line-through !text-gray-400' content={content} />
                          </div>
                          <EditTitle title={t('appAnnotation.editBy', {
                            author: annotation?.logAnnotation.account?.name,
                          })} />
                        </div>
                      )}

                      <div>
                        <Markdown content={annotation?.logAnnotation ? annotation?.logAnnotation.content : content} />
                      </div>
                      {(hasAnnotation && !annotation?.logAnnotation) && (
                        <EditTitle className='mt-1' title={t('appAnnotation.editBy', {
                          author: annotation.authorName,
                        })} />
                      )}
                    </div>
                  )}
                {
                  !!citation?.length && !isThinking && isShowCitation && !isResponsing && (
                    <Citation data={citation} showHitInfo={isShowCitationHitInfo} />
                  )
                }
              </div>
              <div className='absolute top-[-14px] right-[-14px] flex flex-row justify-end gap-1'>
                {!item.isOpeningStatement && (
                  <CopyBtn
                    value={content}
                    className={cn(s.copyBtn, 'mr-1')}
                  />
                )}
                {supportAnnotation && (
                  <AnnotationCtrlBtn
                    appId={appId!}
                    messageId={id}
                    annotationId={annotation?.id || ''}
                    className={cn(s.annotationBtn, 'ml-1')}
                    cached={hasAnnotation}
                    query={question}
                    answer={content}
                    onAdded={(id, authorName) => onAnnotationAdded?.(id, authorName, question, content)}
                    onEdit={() => setIsShowReplyModal(true)}
                    onRemoved={onAnnotationRemoved!}
                  />
                )}

                <EditReplyModal
                  isShow={isShowReplyModal}
                  onHide={() => setIsShowReplyModal(false)}
                  query={question}
                  answer={content}
                  onEdited={onAnnotationEdited!}
                  onAdded={onAnnotationAdded!}
                  appId={appId!}
                  messageId={id}
                  annotationId={annotation?.id || ''}
                  createdAt={annotation?.created_at}
                  onRemove={() => { }}
                />
                {hasAnnotation && renderHasAnnotationBtn()}

                {!feedbackDisabled && !item.feedbackDisabled && renderItemOperation(displayScene !== 'console')}
                {/* Admin feedback is displayed only in the background. */}
                {!feedbackDisabled && renderFeedbackRating(localAdminFeedback?.rating, false, false)}
                {/* User feedback must be displayed */}
                {!feedbackDisabled && renderFeedbackRating(feedback?.rating, !isHideFeedbackEdit, displayScene !== 'console')}
              </div>
            </div>

            {more && <MoreInfo className='invisible group-hover:visible' more={more} isQuestion={false} />}
          </div>
        </div>
      </div>
    </div>
  )
}
export default React.memo(Answer)
