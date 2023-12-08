'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import EditItem, { EditItemType } from '../edit-annotation-modal/edit-item'
import type { AnnotationItem } from '../type'
import Drawer from '@/app/components/base/drawer-plus'
import { MessageCheckRemove } from '@/app/components/base/icons/src/vender/line/communication'
import DeleteConfirmModal from '@/app/components/base/modal/delete-confirm-modal'
import TabSlider from '@/app/components/base/tab-slider-plain'

type Props = {
  isShow: boolean
  onHide: () => void
  item: AnnotationItem
  onSave: (editedQuery: string, editedAnswer: string) => void
  onRemove: () => void
}

enum TabType {
  annotation = 'annotation',
  hitHistory = 'hitHistory',
}

const ViewAnnotationModal: FC<Props> = ({
  isShow,
  onHide,
  item,
  onSave,
  onRemove,
}) => {
  const { id, question, answer, created_at: createdAt } = item
  const { t } = useTranslation()
  const tabs = [
    { value: TabType.annotation, text: t('appLog.title') },
    { value: TabType.hitHistory, text: t('appAnnotation.title') },
  ]
  const [activeTab, setActiveTab] = useState(TabType.annotation)
  const handleSave = (type: EditItemType, editedContent: string) => {
    if (type === EditItemType.Query)
      onSave(editedContent, answer)
    else
      onSave(question, editedContent)
  }
  const [showModal, setShowModal] = useState(false)

  const annotationTab = (
    <div className='p-6 pb-4 space-y-6'>
      <EditItem
        type={EditItemType.Query}
        content={question}
        onSave={editedContent => handleSave(EditItemType.Query, editedContent)}
      />
      <EditItem
        type={EditItemType.Answer}
        content={answer}
        onSave={editedContent => handleSave(EditItemType.Answer, editedContent)}
      />
    </div>
  )

  const hitHistoryTab = (
    <div>Hit Histroy</div>
  )
  return (
    <div>
      <Drawer
        isShow={isShow}
        onHide={onHide}
        maxWidthClassName='!max-w-[480px]'
        // t('appAnnotation.editModal.title') as string
        title={
          <TabSlider
            className='shrink-0 relative top-[9px]'
            value={activeTab}
            onChange={v => setActiveTab(v as TabType)}
            options={tabs}
            noBorderBottom
            itemClassName='!pb-3.5'
          />
        }
        body={(
          activeTab === TabType.annotation ? annotationTab : hitHistoryTab
        )}
        foot={id
          ? (
            <div className='px-4 flex h-16 items-center justify-between border-t border-black/5 bg-gray-50 rounded-bl-xl rounded-br-xl leading-[18px] text-[13px] font-medium text-gray-500'>
              <div
                className='flex items-center pl-3 space-x-2 cursor-pointer'
                onClick={() => setShowModal(true)}
              >
                <MessageCheckRemove />
                <div>{t('appAnnotation.editModal.removeThisCache')}</div>
              </div>
              <div>{t('appAnnotation.editModal.createdAt')}&nbsp;{createdAt}</div>
            </div>
          )
          : undefined}
      >
      </Drawer>
      <DeleteConfirmModal
        isShow={showModal}
        onHide={() => setShowModal(false)}
        onRemove={() => {
          onRemove()
          setShowModal(false)
        }}
        text={t('appDebug.feature.annotation.removeConfirm') as string}
      />
    </div>

  )
}
export default React.memo(ViewAnnotationModal)
