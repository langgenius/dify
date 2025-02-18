'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import EditItem, { EditItemType } from './edit-item'
import Drawer from '@/app/components/base/drawer-plus'
import { MessageCheckRemove } from '@/app/components/base/icons/src/vender/line/communication'
import Confirm from '@/app/components/base/confirm'
import { addAnnotation, editAnnotation } from '@/service/annotation'
import Toast from '@/app/components/base/toast'
import { useProviderContext } from '@/context/provider-context'
import AnnotationFull from '@/app/components/billing/annotation-full'
import useTimestamp from '@/hooks/use-timestamp'

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
    if (!isAdd) {
      await editAnnotation(appId, annotationId, {
        message_id: messageId,
        question: postQuery,
        answer: postAnswer,
      })
      onEdited(postQuery, postAnswer)
    }
    else {
      const res: any = await addAnnotation(appId, {
        question: postQuery,
        answer: postAnswer,
        message_id: messageId,
      })
      onAdded(res.id, res.account?.name, postQuery, postAnswer)
    }

    Toast.notify({
      message: t('common.api.actionSuccess') as string,
      type: 'success',
    })
  }
  const [showModal, setShowModal] = useState(false)

  return (
    <div>
      <Drawer
        isShow={isShow}
        onHide={onHide}
        maxWidthClassName='!max-w-[480px]'
        title={t('appAnnotation.editModal.title') as string}
        body={(
          <div>
            <div className='space-y-6 p-6 pb-4'>
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
                title={t('appDebug.feature.annotation.removeConfirm')}
              />
            </div>
          </div>
        )}
        foot={
          <div>
            {isAnnotationFull && (
              <div className='mb-4 mt-6 px-6'>
                <AnnotationFull />
              </div>
            )}

            {
              annotationId
                ? (
                  <div className='border-divider-subtle bg-background-section-burn system-sm-medium text-text-tertiary flex h-16 items-center justify-between rounded-bl-xl rounded-br-xl border-t px-4'>
                    <div
                      className='flex cursor-pointer items-center space-x-2 pl-3'
                      onClick={() => setShowModal(true)}
                    >
                      <MessageCheckRemove />
                      <div>{t('appAnnotation.editModal.removeThisCache')}</div>
                    </div>
                    {createdAt && <div>{t('appAnnotation.editModal.createdAt')}&nbsp;{formatTime(createdAt, t('appLog.dateTimeFormat') as string)}</div>}
                  </div>
                )
                : undefined
            }
          </div>
        }
      />
    </div>

  )
}
export default React.memo(EditAnnotationModal)
