'use client'
import type { FC } from 'react'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pagination } from 'react-headless-pagination'
import { ArrowLeftIcon, ArrowRightIcon } from '@heroicons/react/24/outline'
import EditItem, { EditItemType } from '../edit-annotation-modal/edit-item'
import type { AnnotationItem, HitHistoryItem } from '../type'
import s from './style.module.css'
import HitHistoryNoData from './hit-history-no-data'
import cn from '@/utils/classnames'
import Drawer from '@/app/components/base/drawer-plus'
import { MessageCheckRemove } from '@/app/components/base/icons/src/vender/line/communication'
import Confirm from '@/app/components/base/confirm'
import TabSlider from '@/app/components/base/tab-slider-plain'
import { fetchHitHistoryList } from '@/service/annotation'
import { APP_PAGE_LIMIT } from '@/config'
import useTimestamp from '@/hooks/use-timestamp'

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
              <div className='flex px-1.5 item-center rounded-md border border-black/[8%] h-5 text-xs font-medium text-gray-500'>{total} {t(`appAnnotation.viewModal.hit${hitHistoryList.length > 1 ? 's' : ''}`)}</div>
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
        <table className={cn(s.table, 'w-full min-w-[440px] border-collapse border-0 text-sm')} >
          <thead className="h-8 leading-8 border-b border-gray-200 text-gray-500 font-bold">
            <tr className='uppercase'>
              <td className='whitespace-nowrap'>{t('appAnnotation.hitHistoryTable.query')}</td>
              <td className='whitespace-nowrap'>{t('appAnnotation.hitHistoryTable.match')}</td>
              <td className='whitespace-nowrap'>{t('appAnnotation.hitHistoryTable.response')}</td>
              <td className='whitespace-nowrap'>{t('appAnnotation.hitHistoryTable.source')}</td>
              <td className='whitespace-nowrap'>{t('appAnnotation.hitHistoryTable.score')}</td>
              <td className='whitespace-nowrap w-[160px]'>{t('appAnnotation.hitHistoryTable.time')}</td>
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
                <td
                  className='whitespace-nowrap overflow-hidden text-ellipsis max-w-[250px]'
                  title={item.match}
                >{item.match}</td>
                <td
                  className='whitespace-nowrap overflow-hidden text-ellipsis max-w-[250px]'
                  title={item.response}
                >{item.response}</td>
                <td>{item.source}</td>
                <td>{item.score ? item.score.toFixed(2) : '-'}</td>
                <td>{formatTime(item.created_at, t('appLog.dateTimeFormat') as string)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {(total && total > APP_PAGE_LIMIT)
          ? <Pagination
            className="flex items-center w-full h-10 text-sm select-none mt-8"
            currentPage={currPage}
            edgePageCount={2}
            middlePagesSiblingCount={1}
            setCurrentPage={setCurrPage}
            totalPages={Math.ceil(total / APP_PAGE_LIMIT)}
            truncatableClassName="w-8 px-0.5 text-center"
            truncatableText="..."
          >
            <Pagination.PrevButton
              disabled={currPage === 0}
              className={`flex items-center mr-2 text-gray-500  focus:outline-none ${currPage === 0 ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:text-gray-600 dark:hover:text-gray-200'}`} >
              <ArrowLeftIcon className="mr-3 h-3 w-3" />
              {t('appLog.table.pagination.previous')}
            </Pagination.PrevButton>
            <div className={`flex items-center justify-center flex-grow ${s.pagination}`}>
              <Pagination.PageButton
                activeClassName="bg-primary-50 dark:bg-opacity-0 text-primary-600 dark:text-white"
                className="flex items-center justify-center h-8 w-8 rounded-full cursor-pointer"
                inactiveClassName="text-gray-500"
              />
            </div>
            <Pagination.NextButton
              disabled={currPage === Math.ceil(total / APP_PAGE_LIMIT) - 1}
              className={`flex items-center mr-2 text-gray-500 focus:outline-none ${currPage === Math.ceil(total / APP_PAGE_LIMIT) - 1 ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:text-gray-600 dark:hover:text-gray-200'}`} >
              {t('appLog.table.pagination.next')}
              <ArrowRightIcon className="ml-3 h-3 w-3" />
            </Pagination.NextButton>
          </Pagination>
          : null}
      </div>

    )
  return (
    <div>
      <Drawer
        isShow={isShow}
        onHide={onHide}
        maxWidthClassName='!max-w-[800px]'
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
          <div>
            <div className='p-6 pb-4 space-y-6'>
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
            <div className='px-4 flex h-16 items-center justify-between border-t border-black/5 bg-gray-50 rounded-bl-xl rounded-br-xl leading-[18px] text-[13px] font-medium text-gray-500'>
              <div
                className='flex items-center pl-3 space-x-2 cursor-pointer'
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
