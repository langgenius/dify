'use client'
import type { FC } from 'react'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDebounce } from 'ahooks'
import { RiEqualizer2Line } from '@remixicon/react'
import Toast from '../../base/toast'
import Filter from './filter'
import type { QueryParam } from './filter'
import List from './list'
import EmptyElement from './empty-element'
import HeaderOpts from './header-opts'
import { AnnotationEnableStatus, type AnnotationItem, type AnnotationItemBasic, JobStatus } from './type'
import ViewAnnotationModal from './view-annotation-modal'
import { MessageFast } from '@/app/components/base/icons/src/vender/solid/communication'
import ActionButton from '@/app/components/base/action-button'
import Pagination from '@/app/components/base/pagination'
import Switch from '@/app/components/base/switch'
import { addAnnotation, delAnnotation, fetchAnnotationConfig as doFetchAnnotationConfig, editAnnotation, fetchAnnotationList, queryAnnotationJobStatus, updateAnnotationScore, updateAnnotationStatus } from '@/service/annotation'
import Loading from '@/app/components/base/loading'
import { APP_PAGE_LIMIT } from '@/config'
import ConfigParamModal from '@/app/components/base/features/new-feature-panel/annotation-reply/config-param-modal'
import type { AnnotationReplyConfig } from '@/models/debug'
import { sleep } from '@/utils'
import { useProviderContext } from '@/context/provider-context'
import AnnotationFullModal from '@/app/components/billing/annotation-full/modal'
import type { App } from '@/types/app'
import cn from '@/utils/classnames'

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
  const debouncedQueryParams = useDebounce(queryParams, { wait: 500 })
  const [limit, setLimit] = React.useState<number>(APP_PAGE_LIMIT)
  const query = {
    page: currPage + 1,
    limit,
    keyword: debouncedQueryParams.keyword || '',
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
    <div className='flex h-full flex-col'>
      <p className='text-text-tertiary system-sm-regular'>{t('appLog.description')}</p>
      <div className='flex flex-1 flex-col py-4'>
        <Filter appId={appDetail.id} queryParams={queryParams} setQueryParams={setQueryParams}>
          <div className='flex items-center space-x-2'>
            {isChatApp && (
              <>
                <div className={cn(!annotationConfig?.enabled && 'pr-2', 'bg-components-panel-bg-blur border-components-panel-border flex h-7 items-center space-x-1 rounded-lg border pl-2')}>
                  <MessageFast className='text-util-colors-indigo-indigo-600 h-4 w-4' />
                  <div className='system-sm-medium text-text-primary'>{t('appAnnotation.name')}</div>
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
                      <div className='bg-divider-subtle mr-1 h-3.5 w-[1px] shrink-0'></div>
                      <ActionButton onClick={() => setIsShowEdit(true)}>
                        <RiEqualizer2Line className='text-text-tertiary h-4 w-4' />
                      </ActionButton>
                    </div>
                  )}
                </div>
                <div className='bg-divider-regular mx-3 h-3.5 w-[1px] shrink-0'></div>
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
            : <div className='flex h-full grow items-center justify-center'><EmptyElement /></div>
        }
        {/* Show Pagination only if the total is more than the limit */}
        {(total && total > APP_PAGE_LIMIT)
          ? <Pagination
            current={currPage}
            onChange={setCurrPage}
            total={total}
            limit={limit}
            onLimitChange={setLimit}
          />
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
