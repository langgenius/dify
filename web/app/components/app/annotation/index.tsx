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
import { AnnotationEnableStatus, type AnnotationItem, type AnnotationItemBasic, JobStatus } from './type'
import ViewAnnotationModal from './view-annotation-modal'
import cn from '@/utils/classnames'
import Switch from '@/app/components/base/switch'
import { addAnnotation, delAnnotation, fetchAnnotationConfig as doFetchAnnotationConfig, editAnnotation, fetchAnnotationList, queryAnnotationJobStatus, updateAnnotationScore, updateAnnotationStatus } from '@/service/annotation'
import Loading from '@/app/components/base/loading'
import { APP_PAGE_LIMIT } from '@/config'
import ConfigParamModal from '@/app/components/app/configuration/toolbox/annotation/config-param-modal'
import type { AnnotationReplyConfig } from '@/models/debug'
import { sleep } from '@/utils'
import { useProviderContext } from '@/context/provider-context'
import AnnotationFullModal from '@/app/components/billing/annotation-full/modal'
import { Settings04 } from '@/app/components/base/icons/src/vender/line/general'
import type { App } from '@/types/app'

type Props = {
  appDetail: App
}

const Annotation: FC<Props> = ({
  appDetail,
}) => {
  const { t } = useTranslation()
  const [isShowEdit, setIsShowEdit] = React.useState(false)
  const [annotationConfig, setAnnotationConfig] = useState<AnnotationReplyConfig | null>(null)
  const [isChatApp, setIsChatApp] = useState(false)

  const fetchAnnotationConfig = async () => {
    const res = await doFetchAnnotationConfig(appDetail.id)
    setAnnotationConfig(res as AnnotationReplyConfig)
    return (res as AnnotationReplyConfig).id
  }
  useEffect(() => {
    const isChatApp = appDetail.mode !== 'completion'
    setIsChatApp(isChatApp)
    if (isChatApp)
      fetchAnnotationConfig()
  }, [])
  const [controlRefreshSwitch, setControlRefreshSwitch] = useState(Date.now())
  const { plan, enableBilling } = useProviderContext()
  const isAnnotationFull = (enableBilling && plan.usage.annotatedResponse >= plan.total.annotatedResponse)
  const [isShowAnnotationFullModal, setIsShowAnnotationFullModal] = useState(false)
  const ensureJobCompleted = async (jobId: string, status: AnnotationEnableStatus) => {
    let isCompleted = false
    while (!isCompleted) {
      const res: any = await queryAnnotationJobStatus(appDetail.id, status, jobId)
      isCompleted = res.job_status === JobStatus.completed
      if (isCompleted)
        break

      await sleep(2000)
    }
  }

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
      const { data, total }: any = await fetchAnnotationList(appDetail.id, {
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
    await addAnnotation(appDetail.id, {
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
    await delAnnotation(appDetail.id, id)
    Toast.notify({
      message: t('common.api.actionSuccess'),
      type: 'success',
    })
    fetchList()
    setControlUpdateList(Date.now())
  }

  const [currItem, setCurrItem] = useState<AnnotationItem | null>(list[0])
  const [isShowViewModal, setIsShowViewModal] = useState(false)
  useEffect(() => {
    if (!isShowEdit)
      setControlRefreshSwitch(Date.now())
  }, [isShowEdit])
  const handleView = (item: AnnotationItem) => {
    setCurrItem(item)
    setIsShowViewModal(true)
  }

  const handleSave = async (question: string, answer: string) => {
    await editAnnotation(appDetail.id, (currItem as AnnotationItem).id, {
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
      <div className='grow flex flex-col py-4 '>
        <Filter appId={appDetail.id} queryParams={queryParams} setQueryParams={setQueryParams}>
          <div className='flex items-center space-x-2'>
            {isChatApp && (
              <>
                <div className={cn(!annotationConfig?.enabled && 'pr-2', 'flex items-center h-7 rounded-lg border border-gray-200 pl-2 space-x-1')}>
                  <div className='leading-[18px] text-[13px] font-medium text-gray-900'>{t('appAnnotation.name')}</div>
                  <Switch
                    key={controlRefreshSwitch}
                    defaultValue={annotationConfig?.enabled}
                    size='md'
                    onChange={async (value) => {
                      if (value) {
                        if (isAnnotationFull) {
                          setIsShowAnnotationFullModal(true)
                          setControlRefreshSwitch(Date.now())
                          return
                        }
                        setIsShowEdit(true)
                      }
                      else {
                        const { job_id: jobId }: any = await updateAnnotationStatus(appDetail.id, AnnotationEnableStatus.disable, annotationConfig?.embedding_model, annotationConfig?.score_threshold)
                        await ensureJobCompleted(jobId, AnnotationEnableStatus.disable)
                        await fetchAnnotationConfig()
                        Toast.notify({
                          message: t('common.api.actionSuccess'),
                          type: 'success',
                        })
                      }
                    }}
                  ></Switch>
                  {annotationConfig?.enabled && (
                    <div className='flex items-center pl-1.5'>
                      <div className='shrink-0 mr-1 w-[1px] h-3.5 bg-gray-200'></div>
                      <div
                        className={`
                      shrink-0  h-7 w-7 flex items-center justify-center
                      text-xs text-gray-700 font-medium 
                    `}
                        onClick={() => { setIsShowEdit(true) }}
                      >
                        <div className='flex h-6 w-6 items-center justify-center rounded-md cursor-pointer hover:bg-gray-200'>
                          <Settings04 className='w-4 h-4' />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                <div className='shrink-0 mx-3 w-[1px] h-3.5 bg-gray-200'></div>
              </>
            )}

            <HeaderOpts
              appId={appDetail.id}
              controlUpdateList={controlUpdateList}
              onAdd={handleAdd}
              onAdded={() => {
                fetchList()
              }}
            />
          </div>
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

        {isShowViewModal && (
          <ViewAnnotationModal
            appId={appDetail.id}
            isShow={isShowViewModal}
            onHide={() => setIsShowViewModal(false)}
            onRemove={async () => {
              await handleRemove((currItem as AnnotationItem)?.id)
            }}
            item={currItem as AnnotationItem}
            onSave={handleSave}
          />
        )}
        {isShowEdit && (
          <ConfigParamModal
            appId={appDetail.id}
            isShow
            isInit={!annotationConfig?.enabled}
            onHide={() => {
              setIsShowEdit(false)
            }}
            onSave={async (embeddingModel, score) => {
              if (
                embeddingModel.embedding_model_name !== annotationConfig?.embedding_model?.embedding_model_name
                || embeddingModel.embedding_provider_name !== annotationConfig?.embedding_model?.embedding_provider_name
              ) {
                const { job_id: jobId }: any = await updateAnnotationStatus(appDetail.id, AnnotationEnableStatus.enable, embeddingModel, score)
                await ensureJobCompleted(jobId, AnnotationEnableStatus.enable)
              }
              const annotationId = await fetchAnnotationConfig()
              if (score !== annotationConfig?.score_threshold)
                await updateAnnotationScore(appDetail.id, annotationId, score)

              await fetchAnnotationConfig()
              Toast.notify({
                message: t('common.api.actionSuccess'),
                type: 'success',
              })
              setIsShowEdit(false)
            }}
            annotationConfig={annotationConfig!}
          />
        )}
        {
          isShowAnnotationFullModal && (
            <AnnotationFullModal
              show={isShowAnnotationFullModal}
              onHide={() => setIsShowAnnotationFullModal(false)}
            />
          )
        }
      </div>
    </div>
  )
}
export default React.memo(Annotation)
