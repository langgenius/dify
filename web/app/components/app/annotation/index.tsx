'use client'
import type { FC } from 'react'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pagination } from 'react-headless-pagination'
import { ArrowLeftIcon, ArrowRightIcon } from '@heroicons/react/24/outline'
import Toast from '../../base/toast'
import Filter from './filter'
import type { QueryParam } from './filter'
import List from './list'
import EmptyElement from './empty-element'
import HeaderOpts from './header-opts'
import s from './style.module.css'
import type { AnnotationItem, AnnotationItemBasic } from './type'
import ViewAnnotationModal from './view-annotation-modal'
import { addAnnotation, delAnnotation, editAnnotation, fetchAnnotationList } from '@/service/annotation'
import Loading from '@/app/components/base/loading'
import { APP_PAGE_LIMIT } from '@/config'

type Props = {
  appId: string
}

const Annotation: FC<Props> = ({
  appId,
}) => {
  const { t } = useTranslation()

  const [queryParams, setQueryParams] = useState<QueryParam>({})
  const [currPage, setCurrPage] = React.useState<number>(0)
  const query = {
    page: currPage + 1,
    limit: APP_PAGE_LIMIT,
    keyword: queryParams.keyword || '',
  }

  const [controlUpdateList, setControlUpdateList] = useState(Date.now())
  const [list, setList] = useState<AnnotationItem[]>([])
  const [total, setTotal] = useState(10)
  const [isLoading, setIsLoading] = useState(false)
  const fetchList = async (page = 1) => {
    setIsLoading(true)
    try {
      const { data, total }: any = await fetchAnnotationList(appId, {
        ...query,
        page,
      })
      setList(data as AnnotationItem[])
      setTotal(total)
    }
    catch (e) {

    }
    setIsLoading(false)
  }

  useEffect(() => {
    fetchList(currPage + 1)
  }, [currPage])

  useEffect(() => {
    fetchList(1)
    setControlUpdateList(Date.now())
  }, [queryParams])

  const handleAdd = async (payload: AnnotationItemBasic) => {
    await addAnnotation(appId, {
      ...payload,
    })
    Toast.notify({
      message: t('common.api.actionSuccess'),
      type: 'success',
    })
    fetchList()
    setControlUpdateList(Date.now())
  }

  const handleRemove = async (id: string) => {
    await delAnnotation(appId, id)
    Toast.notify({
      message: t('common.api.actionSuccess'),
      type: 'success',
    })
    fetchList()
    setControlUpdateList(Date.now())
  }

  const [currItem, setCurrItem] = useState<AnnotationItem | null>(list[0])
  const [isShowViewModal, setIsShowViewModal] = useState(false)
  const handleView = (item: AnnotationItem) => {
    setCurrItem(item)
    setIsShowViewModal(true)
  }

  const handleSave = async (question: string, answer: string) => {
    await editAnnotation(appId, (currItem as AnnotationItem).id, {
      question,
      answer,
    })
    Toast.notify({
      message: t('common.api.actionSuccess'),
      type: 'success',
    })
    fetchList()
    setControlUpdateList(Date.now())
  }

  return (
    <div className='flex flex-col h-full'>
      <p className='flex text-sm font-normal text-gray-500'>{t('appLog.description')}</p>
      <div className='flex flex-col py-4 flex-1'>
        <Filter appId={appId} queryParams={queryParams} setQueryParams={setQueryParams}>
          <HeaderOpts
            appId={appId}
            controlUpdateList={controlUpdateList}
            onAdd={handleAdd}
          />
        </Filter>
        {isLoading
          ? <Loading type='app' />
          : total > 0
            ? <List
              list={list}
              onRemove={handleRemove}
              onView={handleView}
            />
            : <div className='grow flex h-full items-center justify-center'><EmptyElement /></div>
        }
        {/* Show Pagination only if the total is more than the limit */}
        {(total && total > APP_PAGE_LIMIT)
          ? <Pagination
            className="flex items-center w-full h-10 text-sm select-none mt-8"
            currentPage={currPage}
            edgePageCount={2}
            middlePagesSiblingCount={1}
            setCurrentPage={setCurrPage}
            totalPages={Math.ceil(total / APP_PAGE_LIMIT)}
            truncableClassName="w-8 px-0.5 text-center"
            truncableText="..."
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

        {isShowViewModal && (
          <ViewAnnotationModal
            appId={appId}
            isShow={isShowViewModal}
            onHide={() => setIsShowViewModal(false)}
            onRemove={() => {
              handleRemove((currItem as AnnotationItem)?.id)
            }}
            item={currItem as AnnotationItem}
            onSave={handleSave}
          />
        )}
      </div>
    </div>
  )
}
export default React.memo(Annotation)
