'use client'
import type { FC } from 'react'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import EditItem, { EditItemType } from '../edit-annotation-modal/edit-item'
import type { AnnotationItem, HitHistoryItem } from '../type'
import HitHistoryNoData from './hit-history-no-data'
import Badge from '@/app/components/base/badge'
import Drawer from '@/app/components/base/drawer-plus'
import Pagination from '@/app/components/base/pagination'
import { MessageCheckRemove } from '@/app/components/base/icons/src/vender/line/communication'
import Confirm from '@/app/components/base/confirm'
import TabSlider from '@/app/components/base/tab-slider-plain'
import { fetchHitHistoryList } from '@/service/annotation'
import { APP_PAGE_LIMIT } from '@/config'
import useTimestamp from '@/hooks/use-timestamp'
import cn from '@/utils/classnames'

type Props = {
  appId: string
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
  appId,
  isShow,
  onHide,
  item,
  onSave,
  onRemove,
}) => {
  const { id, question, answer, created_at: createdAt } = item
  const [newQuestion, setNewQuery] = useState(question)
  const [newAnswer, setNewAnswer] = useState(answer)
  const { t } = useTranslation()
  const { formatTime } = useTimestamp()
  const [currPage, setCurrPage] = React.useState<number>(0)
  const [total, setTotal] = useState(0)
  const [hitHistoryList, setHitHistoryList] = useState<HitHistoryItem[]>([])
  const fetchHitHistory = async (page = 1) => {
    try {
      const { data, total }: any = await fetchHitHistoryList(appId, id, {
        page,
        limit: 10,
      })
      setHitHistoryList(data as HitHistoryItem[])
      setTotal(total)
    }
    catch (e) {
    }
  }

  useEffect(() => {
    fetchHitHistory(currPage + 1)
  }, [currPage])

  const tabs = [
    { value: TabType.annotation, text: t('appAnnotation.viewModal.annotatedResponse') },
    {
      value: TabType.hitHistory,
      text: (
        hitHistoryList.length > 0
          ? (
            <div className='flex items-center space-x-1'>
              <div>{t('appAnnotation.viewModal.hitHistory')}</div>
              <Badge
                text={`${total} ${t(`appAnnotation.viewModal.hit${hitHistoryList.length > 1 ? 's' : ''}`)}`}
              />
            </div>
          )
          : t('appAnnotation.viewModal.hitHistory')
      ),
    },
  ]
  const [activeTab, setActiveTab] = useState(TabType.annotation)
  const handleSave = (type: EditItemType, editedContent: string) => {
    if (type === EditItemType.Query) {
      setNewQuery(editedContent)
      onSave(editedContent, newAnswer)
    }
    else {
      setNewAnswer(editedContent)
      onSave(newQuestion, editedContent)
    }
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

  const hitHistoryTab = total === 0
    ? (<HitHistoryNoData />)
    : (
      <div>
        <table className={cn('w-full min-w-[440px] border-collapse border-0')} >
          <thead className="system-xs-medium-uppercase text-text-tertiary">
            <tr>
              <td className='bg-background-section-burn w-5 whitespace-nowrap rounded-l-lg pl-2 pr-1'>{t('appAnnotation.hitHistoryTable.query')}</td>
              <td className='bg-background-section-burn whitespace-nowrap py-1.5 pl-3'>{t('appAnnotation.hitHistoryTable.match')}</td>
              <td className='bg-background-section-burn whitespace-nowrap py-1.5 pl-3'>{t('appAnnotation.hitHistoryTable.response')}</td>
              <td className='bg-background-section-burn whitespace-nowrap py-1.5 pl-3'>{t('appAnnotation.hitHistoryTable.source')}</td>
              <td className='bg-background-section-burn whitespace-nowrap py-1.5 pl-3'>{t('appAnnotation.hitHistoryTable.score')}</td>
              <td className='bg-background-section-burn w-[160px] whitespace-nowrap rounded-r-lg py-1.5 pl-3'>{t('appAnnotation.hitHistoryTable.time')}</td>
            </tr>
          </thead>
          <tbody className="text-text-secondary system-sm-regular">
            {hitHistoryList.map(item => (
              <tr
                key={item.id}
                className={'border-divider-subtle hover:bg-background-default-hover cursor-pointer border-b'}
              >
                <td
                  className='max-w-[250px] overflow-hidden text-ellipsis whitespace-nowrap p-3 pr-2'
                  title={item.question}
                >{item.question}</td>
                <td
                  className='max-w-[250px] overflow-hidden text-ellipsis whitespace-nowrap p-3 pr-2'
                  title={item.match}
                >{item.match}</td>
                <td
                  className='max-w-[250px] overflow-hidden text-ellipsis whitespace-nowrap p-3 pr-2'
                  title={item.response}
                >{item.response}</td>
                <td className='p-3 pr-2'>{item.source}</td>
                <td className='p-3 pr-2'>{item.score ? item.score.toFixed(2) : '-'}</td>
                <td className='p-3 pr-2'>{formatTime(item.created_at, t('appLog.dateTimeFormat') as string)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {(total && total > APP_PAGE_LIMIT)
          ? <Pagination
            className='px-0'
            current={currPage}
            onChange={setCurrPage}
            total={total}
          />
          : null}
      </div>

    )
  return (
    <div>
      <Drawer
        isShow={isShow}
        onHide={onHide}
        maxWidthClassName='!max-w-[800px]'
        title={
          <TabSlider
            className='relative top-[9px] shrink-0'
            value={activeTab}
            onChange={v => setActiveTab(v as TabType)}
            options={tabs}
            noBorderBottom
            itemClassName='!pb-3.5'
          />
        }
        body={(
          <div>
            <div className='space-y-6 p-6 pb-4'>
              {activeTab === TabType.annotation ? annotationTab : hitHistoryTab}
            </div>
            <Confirm
              isShow={showModal}
              onCancel={() => setShowModal(false)}
              onConfirm={async () => {
                await onRemove()
                setShowModal(false)
                onHide()
              }}
              title={t('appDebug.feature.annotation.removeConfirm')}
            />
          </div>
        )}
        foot={id
          ? (
            <div className='border-divider-subtle bg-background-section-burn system-sm-medium text-text-tertiary flex h-16 items-center justify-between rounded-bl-xl rounded-br-xl border-t px-4'>
              <div
                className='flex cursor-pointer items-center space-x-2 pl-3'
                onClick={() => setShowModal(true)}
              >
                <MessageCheckRemove />
                <div>{t('appAnnotation.editModal.removeThisCache')}</div>
              </div>
              <div>{t('appAnnotation.editModal.createdAt')}&nbsp;{formatTime(createdAt, t('appLog.dateTimeFormat') as string)}</div>
            </div>
          )
          : undefined}
      />
    </div>

  )
}
export default React.memo(ViewAnnotationModal)
