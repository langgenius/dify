'use client'
import type { FC } from 'react'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import {
  Drawer,
  DrawerBackdrop,
  DrawerCloseButton,
  DrawerContent,
  DrawerPopup,
  DrawerPortal,
  DrawerTitle,
  DrawerViewport,
} from '@langgenius/dify-ui/drawer'
import { toast } from '@langgenius/dify-ui/toast'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageCheckRemove } from '@/app/components/base/icons/src/vender/line/communication'
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

      toast.success(t('api.actionSuccess', { ns: 'common' }) as string)
    }
    catch (error) {
      const fallbackMessage = t('api.actionFailed', { ns: 'common' }) as string
      const message = error instanceof Error && error.message ? error.message : fallbackMessage
      toast.error(message)
      // Re-throw to preserve edit mode behavior for UI components
      throw error
    }
  }
  const [showModal, setShowModal] = useState(false)
  if (!isShow)
    return null

  return (
    <div>
      <Drawer
        open
        modal
        disablePointerDismissal
        swipeDirection="right"
        onOpenChange={(open) => {
          if (!open)
            onHide()
        }}
      >
        <DrawerPortal>
          <DrawerBackdrop />
          <DrawerViewport>
            <DrawerPopup className="data-[swipe-direction=right]:top-16 data-[swipe-direction=right]:right-2 data-[swipe-direction=right]:bottom-3 data-[swipe-direction=right]:h-auto data-[swipe-direction=right]:w-120 data-[swipe-direction=right]:max-w-[calc(100vw-1rem)] data-[swipe-direction=right]:rounded-xl data-[swipe-direction=right]:border-r-[0.5px] data-[swipe-direction=right]:border-divider-subtle">
              <DrawerContent className="flex min-h-0 flex-1 flex-col p-0 pb-0">
                <div className="shrink-0 border-b border-divider-subtle py-4">
                  <div className="flex h-6 items-center justify-between pr-5 pl-6">
                    <DrawerTitle className="min-w-0 truncate system-xl-semibold text-text-primary">
                      {t('editModal.title', { ns: 'appAnnotation' })}
                    </DrawerTitle>
                    <DrawerCloseButton
                      aria-label={t('operation.close', { ns: 'common' })}
                      className="h-6 w-6 rounded-md"
                    />
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
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
                    <AlertDialog open={showModal} onOpenChange={open => !open && setShowModal(false)}>
                      <AlertDialogContent>
                        <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
                          <AlertDialogTitle
                            title={t('feature.annotation.removeConfirm', { ns: 'appDebug' })}
                            className="w-full truncate title-2xl-semi-bold text-text-primary"
                          >
                            {t('feature.annotation.removeConfirm', { ns: 'appDebug' })}
                          </AlertDialogTitle>
                        </div>
                        <AlertDialogActions>
                          <AlertDialogCancelButton>
                            {t('operation.cancel', { ns: 'common' })}
                          </AlertDialogCancelButton>
                          <AlertDialogConfirmButton
                            tone="destructive"
                            onClick={() => {
                              onRemove()
                              setShowModal(false)
                              onHide()
                            }}
                          >
                            {t('operation.confirm', { ns: 'common' })}
                          </AlertDialogConfirmButton>
                        </AlertDialogActions>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
                <div className="shrink-0">
                  {isAnnotationFull && (
                    <div className="mt-6 mb-4 px-6">
                      <AnnotationFull />
                    </div>
                  )}

                  {
                    annotationId
                      ? (
                          <div className="flex h-16 items-center justify-between rounded-br-xl rounded-bl-xl border-t border-divider-subtle bg-background-section-burn px-4 system-sm-medium text-text-tertiary">
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
              </DrawerContent>
            </DrawerPopup>
          </DrawerViewport>
        </DrawerPortal>
      </Drawer>
    </div>

  )
}
export default React.memo(EditAnnotationModal)
