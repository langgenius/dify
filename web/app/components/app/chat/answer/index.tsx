'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { UserCircleIcon } from '@heroicons/react/24/solid'
import cn from 'classnames'
import type { DisplayScene, FeedbackFunc, Feedbacktype, IChatItem, SubmitAnnotationFunc, ThoughtItem } from '../type'
import { randomString } from '../../../app-sidebar/basic'
import OperationBtn from '../operation'
import LoadingAnim from '../loading-anim'
import { EditIcon, EditIconSolid, OpeningStatementIcon, RatingIcon } from '../icon-component'
import s from '../style.module.css'
import MoreInfo from '../more-info'
import CopyBtn from '../copy-btn'
import Thought from '../thought'
import type { Annotation, MessageRating } from '@/models/log'
import AppContext from '@/context/app-context'
import Tooltip from '@/app/components/base/tooltip'
import { Markdown } from '@/app/components/base/markdown'
import AutoHeightTextarea from '@/app/components/base/auto-height-textarea'
import Button from '@/app/components/base/button'
import type { DataSet } from '@/models/datasets'
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
  onSubmitAnnotation?: SubmitAnnotationFunc
  displayScene: DisplayScene
  isResponsing?: boolean
  answerIconClassName?: string
  thoughts?: ThoughtItem[]
  isThinking?: boolean
  dataSets?: DataSet[]
}
// The component needs to maintain its own state to control whether to display input component
const Answer: FC<IAnswerProps> = ({ item, feedbackDisabled = false, isHideFeedbackEdit = false, onFeedback, onSubmitAnnotation, displayScene = 'web', isResponsing, answerIconClassName, thoughts, isThinking, dataSets }) => {
  const { id, content, more, feedback, adminFeedback, annotation: initAnnotation } = item
  const [showEdit, setShowEdit] = useState(false)
  const [loading, setLoading] = useState(false)
  const [annotation, setAnnotation] = useState<Annotation | undefined | null>(initAnnotation)
  const [inputValue, setInputValue] = useState<string>(initAnnotation?.content ?? '')
  const [localAdminFeedback, setLocalAdminFeedback] = useState<Feedbacktype | undefined | null>(adminFeedback)
  const { userProfile } = useContext(AppContext)
  const { t } = useTranslation()

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
        <Tooltip selector={`user-feedback-${randomString(16)}`} content={t('appLog.detail.operation.addAnnotation') as string}>
          {OperationBtn({
            innerContent: <IconWrapper><EditIcon className='hover:text-gray-800' /></IconWrapper>,
            onClick: () => setShowEdit(true),
          })}
        </Tooltip>
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
        <div className={`${s.answerIcon} ${answerIconClassName} w-10 h-10 shrink-0`}>
          {isResponsing
            && <div className={s.typeingIcon}>
              <LoadingAnim type='avatar' />
            </div>
          }
        </div>
        <div className={s.answerWrapWrap}>
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
                      <Markdown content={content} />
                    </div>
                  )}
                {!showEdit
                  ? (annotation?.content
                    && <>
                      <Divider name={annotation?.account?.name || userProfile?.name} />
                      {annotation.content}
                    </>)
                  : <>
                    <Divider name={annotation?.account?.name || userProfile?.name} />
                    <AutoHeightTextarea
                      placeholder={t('appLog.detail.operation.annotationPlaceholder') as string}
                      value={inputValue}
                      onChange={e => setInputValue(e.target.value)}
                      minHeight={58}
                      className={`${cn(s.textArea)} !py-2 resize-none block w-full !px-3 bg-gray-50 border border-gray-200 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm text-gray-700 tracking-[0.2px]`}
                    />
                    <div className="mt-2 flex flex-row">
                      <Button
                        type='primary'
                        className='mr-2'
                        loading={loading}
                        onClick={async () => {
                          if (!inputValue)
                            return
                          setLoading(true)
                          const res = await onSubmitAnnotation?.(id, inputValue)
                          if (res)
                            setAnnotation({ ...annotation, content: inputValue } as any)
                          setLoading(false)
                          setShowEdit(false)
                        }}>{t('common.operation.confirm')}</Button>
                      <Button
                        onClick={() => {
                          setInputValue(annotation?.content ?? '')
                          setShowEdit(false)
                        }}>{t('common.operation.cancel')}</Button>
                    </div>
                  </>
                }
              </div>
              <div className='absolute top-[-14px] right-[-14px] flex flex-row justify-end gap-1'>
                {!item.isOpeningStatement && (
                  <CopyBtn
                    value={content}
                    className={cn(s.copyBtn, 'mr-1')}
                  />
                )}
                {!feedbackDisabled && !item.feedbackDisabled && renderItemOperation(displayScene !== 'console')}
                {/* Admin feedback is displayed only in the background. */}
                {!feedbackDisabled && renderFeedbackRating(localAdminFeedback?.rating, false, false)}
                {/* User feedback must be displayed */}
                {!feedbackDisabled && renderFeedbackRating(feedback?.rating, !isHideFeedbackEdit, displayScene !== 'console')}
              </div>
            </div>
            {more && <MoreInfo more={more} isQuestion={false} />}
          </div>
        </div>
      </div>
    </div>
  )
}
export default React.memo(Answer)
