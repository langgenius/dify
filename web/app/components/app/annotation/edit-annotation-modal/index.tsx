'use client'
import type { FC } from 'react'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Confirm from '@/app/components/base/confirm'
import Drawer from '@/app/components/base/drawer-plus'
import { MessageCheckRemove } from '@/app/components/base/icons/src/vender/line/communication'
import Toast from '@/app/components/base/toast'
import AnnotationFull from '@/app/components/billing/annotation-full'
import { useProviderContext } from '@/context/provider-context'
import useTimestamp from '@/hooks/use-timestamp'
import { addAnnotation, editAnnotation } from '@/service/annotation'
import EditItem, { EditItemType } from './edit-item'

type Props = {
  isShow: boolean
  onHide: () => void
  appId: string
  messageId?: string
  annotationId?: string
  query: string
  answer: string
  onEdited: (editedQuery: string, editedAnswer: string) => void
  onAdded: (annotationId: string, authorName: string, editedQuery: string, editedAnswer: string) => void
  createdAt?: number
  onRemove: () => void
  onlyEditResponse?: boolean
}

const EditAnnotationModal: FC<Props> = ({
  isShow,
  onHide,
  query,
  answer,
  onEdited,
  onAdded,
  appId,
  messageId,
  annotationId,
  createdAt,
  onRemove,
  onlyEditResponse,
}) => {
  const { t } = useTranslation()
  const { formatTime } = useTimestamp()
  const { plan, enableBilling } = useProviderContext()
  const isAdd = !annotationId
  const isAnnotationFull = (enableBilling && plan.usage.annotatedResponse >= plan.total.annotatedResponse)
  const handleSave = async (type: EditItemType, editedContent: string) => {
    let postQuery = query
    let postAnswer = answer
    if (type === EditItemType.Query)
      postQuery = editedContent
    else
      postAnswer = editedContent
    try {
      if (!isAdd) {
        await editAnnotation(appId, annotationId, {
          message_id: messageId,
          question: postQuery,
          answer: postAnswer,
        })
        onEdited(postQuery, postAnswer)
      }
      else {
        const res = await addAnnotation(appId, {
          question: postQuery,
          answer: postAnswer,
          message_id: messageId,
        })
        onAdded(res.id, res.account?.name ?? '', postQuery, postAnswer)
      }

      Toast.notify({
        message: t('api.actionSuccess', { ns: 'common' }) as string,
        type: 'success',
      })
    }
    catch (error) {
      const fallbackMessage = t('api.actionFailed', { ns: 'common' }) as string
      const message = error instanceof Error && error.message ? error.message : fallbackMessage
      Toast.notify({
        message,
        type: 'error',
      })
      // Re-throw to preserve edit mode behavior for UI components
      throw error
    }
  }
  const [showModal, setShowModal] = useState(false)

  return (
    <div>
      <Drawer
        isShow={isShow}
        onHide={onHide}
        maxWidthClassName="!max-w-[480px]"
        title={t('editModal.title', { ns: 'appAnnotation' }) as string}
        body={(
          <div>
            <div className="space-y-6 p-6 pb-4">
              <EditItem
                type={EditItemType.Query}
                content={query}
                readonly={(isAdd && isAnnotationFull) || onlyEditResponse}
                onSave={editedContent => handleSave(EditItemType.Query, editedContent)}
              />
              <EditItem
                type={EditItemType.Answer}
                content={answer}
                readonly={isAdd && isAnnotationFull}
                onSave={editedContent => handleSave(EditItemType.Answer, editedContent)}
              />
              <Confirm
                isShow={showModal}
                onCancel={() => setShowModal(false)}
                onConfirm={() => {
                  onRemove()
                  setShowModal(false)
                  onHide()
                }}
                title={t('feature.annotation.removeConfirm', { ns: 'appDebug' })}
              />
            </div>
          </div>
        )}
        foot={(
          <div>
            {isAnnotationFull && (
              <div className="mb-4 mt-6 px-6">
                <AnnotationFull />
              </div>
            )}

            {
              annotationId
                ? (
                    <div className="system-sm-medium flex h-16 items-center justify-between rounded-bl-xl rounded-br-xl border-t border-divider-subtle bg-background-section-burn px-4 text-text-tertiary">
                      <div
                        className="flex cursor-pointer items-center space-x-2 pl-3"
                        onClick={() => setShowModal(true)}
                      >
                        <MessageCheckRemove />
                        <div>{t('editModal.removeThisCache', { ns: 'appAnnotation' })}</div>
                      </div>
                      {!!createdAt && (
                        <div>
                          {t('editModal.createdAt', { ns: 'appAnnotation' })}
&nbsp;
                          {formatTime(createdAt, t('dateTimeFormat', { ns: 'appLog' }) as string)}
                        </div>
                      )}
                    </div>
                  )
                : undefined
            }
          </div>
        )}
      />
    </div>

  )
}
export default React.memo(EditAnnotationModal)
