'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import dayjs from 'dayjs'
import EditItem, { EditItemType } from '../edit-annotation-modal/edit-item'
import type { AnnotationItem } from '../type'
import { hitHistoryList } from '../mock-data'
import s from './style.module.css'
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
    { value: TabType.annotation, text: t('appAnnotation.viewModal.annotatedResponse') },
    { value: TabType.hitHistory, text: t('appAnnotation.viewModal.hitHistory') },
  ]
  const [activeTab, setActiveTab] = useState(TabType.hitHistory)
  const handleSave = (type: EditItemType, editedContent: string) => {
    if (type === EditItemType.Query)
      onSave(editedContent, answer)
    else
      onSave(question, editedContent)
  }
  const [showModal, setShowModal] = useState(false)

  const annotationTab = (
    <>

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
    </>
  )

  const hitHistoryTab = (
    <table className={cn(s.table, 'w-full min-w-[440px] border-collapse border-0 text-sm')} >
      <thead className="h-8 leading-8 border-b border-gray-200 text-gray-500 font-bold">
        <tr className='uppercase'>
          <td className='whitespace-nowrap'>{t('appAnnotation.hitHistoryTable.question')}</td>
          <td className='whitespace-nowrap'>{t('appAnnotation.hitHistoryTable.source')}</td>
          <td className='whitespace-nowrap'>{t('appAnnotation.hitHistoryTable.score')}</td>
          <td className='whitespace-nowrap w-[140px]'>{t('appAnnotation.hitHistoryTable.time')}</td>
        </tr>
      </thead>
      <tbody className="text-gray-500">
        {hitHistoryList.map(item => (
          <tr
            key={item.id}
            className={'border-b border-gray-200 h-8 hover:bg-gray-50 cursor-pointer'}
          >
            <td
              className='whitespace-nowrap overflow-hidden text-ellipsis max-w-[250px]'
              title={item.question}
            >{item.question}</td>
            <td>{item.source}</td>
            <td>{item.score}</td>
            <td>{dayjs(item.created_at).format('YYYY-MM-DD hh:mm')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
  return (
    <div>
      <Drawer
        isShow={isShow}
        onHide={onHide}
        maxWidthClassName='!max-w-[640px]'
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
          <div className='p-6 pb-4 space-y-6'>
            {activeTab === TabType.annotation ? annotationTab : hitHistoryTab}
          </div>
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
