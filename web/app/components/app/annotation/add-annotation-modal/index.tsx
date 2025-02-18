'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AnnotationItemBasic } from '../type'
import EditItem, { EditItemType } from './edit-item'
import Checkbox from '@/app/components/base/checkbox'
import Drawer from '@/app/components/base/drawer-plus'
import Button from '@/app/components/base/button'
import Toast from '@/app/components/base/toast'
import { useProviderContext } from '@/context/provider-context'
import AnnotationFull from '@/app/components/billing/annotation-full'
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
      return t('appAnnotation.errorMessage.queryRequired')

    if (!payload.answer)
      return t('appAnnotation.errorMessage.answerRequired')

    return true
  }

  const handleSave = async () => {
    const payload = {
      question,
      answer,
    }
    if (isValid(payload) !== true) {
      Toast.notify({
        type: 'error',
        message: isValid(payload) as string,
      })
      return
    }

    setIsSaving(true)
    try {
      await onAdd(payload)
    }
    catch (e) {
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
  return (
    <div>
      <Drawer
        isShow={isShow}
        onHide={onHide}
        maxWidthClassName='!max-w-[480px]'
        title={t('appAnnotation.addModal.title') as string}
        body={(
          <div className='space-y-6 p-6 pb-4'>
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
        )}
        foot={
          (
            <div>
              {isAnnotationFull && (
                <div className='mb-4 mt-6 px-6'>
                  <AnnotationFull />
                </div>
              )}
              <div className='border-divider-subtle bg-background-section-burn system-sm-medium text-text-tertiary flex h-16 items-center justify-between rounded-bl-xl rounded-br-xl border-t px-4'>
                <div
                  className='flex items-center space-x-2'
                >
                  <Checkbox checked={isCreateNext} onCheck={() => setIsCreateNext(!isCreateNext)} />
                  <div>{t('appAnnotation.addModal.createNext')}</div>
                </div>
                <div className='mt-2 flex space-x-2'>
                  <Button className='h-7 text-xs' onClick={onHide}>{t('common.operation.cancel')}</Button>
                  <Button className='h-7 text-xs' variant='primary' onClick={handleSave} loading={isSaving} disabled={isAnnotationFull}>{t('common.operation.add')}</Button>
                </div>
              </div>
            </div>

          )
        }
      >
      </Drawer>
    </div>
  )
}
export default React.memo(AddAnnotationModal)
