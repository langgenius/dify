'use client'
import type { FC } from 'react'
import type { AnnotationItemBasic } from '../type'
import { Button } from '@langgenius/dify-ui/button'
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
import Checkbox from '@/app/components/base/checkbox'
import AnnotationFull from '@/app/components/billing/annotation-full'
import { useProviderContext } from '@/context/provider-context'
import EditItem, { EditItemType } from './edit-item'

type Props = {
  isShow: boolean
  onHide: () => void
  onAdd: (payload: AnnotationItemBasic) => void
}

const AddAnnotationModal: FC<Props> = ({
  isShow,
  onHide,
  onAdd,
}) => {
  const { t } = useTranslation()
  const { plan, enableBilling } = useProviderContext()
  const isAnnotationFull = (enableBilling && plan.usage.annotatedResponse >= plan.total.annotatedResponse)
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [isCreateNext, setIsCreateNext] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const isValid = (payload: AnnotationItemBasic) => {
    if (!payload.question)
      return t('errorMessage.queryRequired', { ns: 'appAnnotation' })

    if (!payload.answer)
      return t('errorMessage.answerRequired', { ns: 'appAnnotation' })

    return true
  }

  const handleSave = async () => {
    const payload = {
      question,
      answer,
    }
    if (isValid(payload) !== true) {
      toast.error(isValid(payload) as string)
      return
    }

    setIsSaving(true)
    try {
      await onAdd(payload)
    }
    catch {
    }
    setIsSaving(false)

    if (isCreateNext) {
      setQuestion('')
      setAnswer('')
    }
    else {
      onHide()
    }
  }
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
                      {t('addModal.title', { ns: 'appAnnotation' })}
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
                      content={question}
                      onChange={setQuestion}
                    />
                    <EditItem
                      type={EditItemType.Answer}
                      content={answer}
                      onChange={setAnswer}
                    />
                  </div>
                </div>
                <div className="shrink-0">
                  {isAnnotationFull && (
                    <div className="mt-6 mb-4 px-6">
                      <AnnotationFull />
                    </div>
                  )}
                  <div className="flex h-16 items-center justify-between rounded-br-xl rounded-bl-xl border-t border-divider-subtle bg-background-section-burn px-4 system-sm-medium text-text-tertiary">
                    <div className="flex items-center space-x-2">
                      <Checkbox id="create-next-checkbox" checked={isCreateNext} onCheck={() => setIsCreateNext(!isCreateNext)} />
                      <div>{t('addModal.createNext', { ns: 'appAnnotation' })}</div>
                    </div>
                    <div className="mt-2 flex space-x-2">
                      <Button className="h-7 text-xs" onClick={onHide}>{t('operation.cancel', { ns: 'common' })}</Button>
                      <Button className="h-7 text-xs" variant="primary" onClick={handleSave} loading={isSaving} disabled={isAnnotationFull}>{t('operation.add', { ns: 'common' })}</Button>
                    </div>
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
export default React.memo(AddAnnotationModal)
