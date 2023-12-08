'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AnnotationItemBasic } from '../type'
import EditItem, { EditItemType } from './edit-item'
import Drawer from '@/app/components/base/drawer-plus'
import Button from '@/app/components/base/button'

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
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const handleSave = () => {
    onAdd({
      question,
      answer,
    })
  }
  return (
    <div>
      <Drawer
        isShow={isShow}
        onHide={onHide}
        maxWidthClassName='!max-w-[480px]'
        title={t('appAnnotation.addModal.title') as string}
        body={(
          <div className='p-6 pb-4 space-y-6'>
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
            <div className='px-4 flex h-16 items-center justify-between border-t border-black/5 bg-gray-50 rounded-bl-xl rounded-br-xl leading-[18px] text-[13px] font-medium text-gray-500'>
              <div
                className=''
              >
                create again
              </div>
              <div className='mt-2 flex space-x-2'>
                <Button className='!h-7 !text-xs !font-medium' type='primary' onClick={handleSave}>{t('common.operation.save')}</Button>
                <Button className='!h-7 !text-xs !font-medium' onClick={onHide}>{t('common.operation.cancel')}</Button>
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
