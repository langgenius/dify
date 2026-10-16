'use client'
import type { AlertDialogActions } from '@langgenius/dify-ui/alert-dialog'
import type { FC } from 'react'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@langgenius/dify-ui/alert-dialog'
import {
  Drawer,
  DrawerBackdrop,
  DrawerClose,
  DrawerContent,
  DrawerPopup,
  DrawerPortal,
  DrawerTitle,
  DrawerViewport,
} from '@langgenius/dify-ui/drawer'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import * as React from 'react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import useTimestamp from '@/hooks/use-timestamp'
import { consoleClient } from '@/service/console'
import EditItem, { EditItemType } from './edit-item'

type Props = Readonly<{
  isShow: boolean
  onHide: () => void
  appId: string
  annotationId: string
  query: string
  answer: string
  onEdited: (editedQuery: string, editedAnswer: string) => void
  createdAt?: number
  onRemove: () => void
  onlyEditResponse?: boolean
}>

const EditAnnotationModal: FC<Props> = ({
  isShow,
  onHide,
  query,
  answer,
  onEdited,
  appId,
  annotationId,
  createdAt,
  onRemove,
  onlyEditResponse,
}) => {
  const { t } = useTranslation(['appAnnotation', 'appDebug', 'appLog', 'common'])
  const { formatTime } = useTimestamp()
  const handleSave = async (type: EditItemType, editedContent: string) => {
    let postQuery = query
    let postAnswer = answer
    if (type === EditItemType.Query) postQuery = editedContent
    else postAnswer = editedContent
    try {
      await consoleClient.apps.byAppId.annotations.byAnnotationId.post({
        params: { app_id: appId, annotation_id: annotationId },
        body: { question: postQuery, answer: postAnswer },
      })
      onEdited(postQuery, postAnswer)

      toast.success(t(($) => $['api.actionSuccess'], { ns: 'common' }) as string)
    } catch (error) {
      const fallbackMessage = t(($) => $['api.actionFailed'], { ns: 'common' }) as string
      const message = error instanceof Error && error.message ? error.message : fallbackMessage
      toast.error(message)
      // Re-throw to preserve edit mode behavior for UI components
      throw error
    }
  }
  const removeActionsRef = useRef<AlertDialogActions>(null)
  if (!isShow) return null

  return (
    <div>
      <Drawer
        open
        modal
        disablePointerDismissal
        swipeDirection="right"
        onOpenChange={(open) => {
          if (!open) onHide()
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
                      {t(($) => $['editModal.title'], { ns: 'appAnnotation' })}
                    </DrawerTitle>
                    <DrawerClose
                      render={
                        <IconButton
                          aria-label={t(($) => $['operation.close'], { ns: 'common' })}
                          size="md"
                        >
                          <span aria-hidden="true" className="i-ri-close-line size-4" />
                        </IconButton>
                      }
                    />
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <div className="space-y-6 p-6 pb-4">
                    <EditItem
                      type={EditItemType.Query}
                      content={query}
                      readonly={onlyEditResponse}
                      onSave={(editedContent) => handleSave(EditItemType.Query, editedContent)}
                    />
                    <EditItem
                      type={EditItemType.Answer}
                      content={answer}
                      onSave={(editedContent) => handleSave(EditItemType.Answer, editedContent)}
                    />
                  </div>
                </div>
                <div className="shrink-0">
                  <div className="flex h-16 items-center justify-between rounded-b-xl border-t border-divider-subtle bg-background-section-burn px-4 system-sm-medium text-text-tertiary">
                    <AlertDialog actionsRef={removeActionsRef}>
                      <AlertDialogTrigger className="flex cursor-pointer items-center space-x-2 pl-3">
                        <span
                          aria-hidden
                          className="i-custom-vender-line-communication-message-check-remove h-6 w-6"
                        />
                        <span>
                          {t(($) => $['editModal.removeThisCache'], { ns: 'appAnnotation' })}
                        </span>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle
                            title={t(($) => $['feature.annotation.removeConfirm'], {
                              ns: 'appDebug',
                            })}
                          >
                            {t(($) => $['feature.annotation.removeConfirm'], { ns: 'appDebug' })}
                          </AlertDialogTitle>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancelButton>
                            {t(($) => $['operation.cancel'], { ns: 'common' })}
                          </AlertDialogCancelButton>
                          <AlertDialogConfirmButton
                            tone="destructive"
                            onClick={() => {
                              onRemove()
                              removeActionsRef.current?.close()
                              onHide()
                            }}
                          >
                            {t(($) => $['operation.confirm'], { ns: 'common' })}
                          </AlertDialogConfirmButton>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                    {!!createdAt && (
                      <div>
                        {t(($) => $['editModal.createdAt'], { ns: 'appAnnotation' })}
                        &nbsp;
                        {formatTime(
                          createdAt,
                          t(($) => $.dateTimeFormat, { ns: 'appLog' }) as string,
                        )}
                      </div>
                    )}
                  </div>
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
