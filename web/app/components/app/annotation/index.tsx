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
import { delAnnotations } from '@/service/annotation'

type Props = {
  appDetail: App
}

const Annotation: FC<Props> = (props) => {
  const { appDetail } = props
  const { t } = useTranslation()
  const [isShowEdit, setIsShowEdit] = useState(false)
  const [annotationConfig, setAnnotationConfig] = useState<AnnotationReplyConfig | null>(null)
  const [isChatApp] = useState(appDetail.mode !== 'completion')
  const [controlRefreshSwitch, setControlRefreshSwitch] = useState(() => Date.now())
  const { plan, enableBilling } = useProviderContext()
  const isAnnotationFull = enableBilling && plan.usage.annotatedResponse >= plan.total.annotatedResponse
  const [isShowAnnotationFullModal, setIsShowAnnotationFullModal] = useState(false)
  const [queryParams, setQueryParams] = useState<QueryParam>({})
  const [currPage, setCurrPage] = useState(0)
  const [limit, setLimit] = useState(APP_PAGE_LIMIT)
  const [list, setList] = useState<AnnotationItem[]>([])
  const [total, setTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [controlUpdateList, setControlUpdateList] = useState(() => Date.now())
  const [currItem, setCurrItem] = useState<AnnotationItem | null>(null)
  const [isShowViewModal, setIsShowViewModal] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const debouncedQueryParams = useDebounce(queryParams, { wait: 500 })

  const fetchAnnotationConfig = async () => {
    const res = await doFetchAnnotationConfig(appDetail.id)
    setAnnotationConfig(res as AnnotationReplyConfig)
    return (res as AnnotationReplyConfig).id
  }

  useEffect(() => {
    if (isChatApp) fetchAnnotationConfig()
  }, [])

  const ensureJobCompleted = async (jobId: string, status: AnnotationEnableStatus) => {
    while (true) {
      const res: any = await queryAnnotationJobStatus(appDetail.id, status, jobId)
      if (res.job_status === JobStatus.completed) break
      await sleep(2000)
    }
  }

  const fetchList = async (page = 1) => {
    setIsLoading(true)
    try {
      const { data, total }: any = await fetchAnnotationList(appDetail.id, {
        page,
        limit,
        keyword: debouncedQueryParams.keyword || '',
      })
      setList(data as AnnotationItem[])
      setTotal(total)
    }
    finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchList(currPage + 1)
  }, [currPage, limit, debouncedQueryParams])

  const handleAdd = async (payload: AnnotationItemBasic) => {
    await addAnnotation(appDetail.id, payload)
    Toast.notify({ message: t('common.api.actionSuccess'), type: 'success' })
    fetchList()
    setControlUpdateList(Date.now())
  }

  const handleRemove = async (id: string) => {
    await delAnnotation(appDetail.id, id)
    Toast.notify({ message: t('common.api.actionSuccess'), type: 'success' })
    fetchList()
    setControlUpdateList(Date.now())
  }

  const handleBatchDelete = async () => {
    try {
      await delAnnotations(appDetail.id, selectedIds)
      Toast.notify({ message: t('common.api.actionSuccess'), type: 'success' })
      fetchList()
      setControlUpdateList(Date.now())
      setSelectedIds([])
    }
    catch (e: any) {
      Toast.notify({ type: 'error', message: e.message || t('common.api.actionFailed') })
    }
  }

  const handleView = (item: AnnotationItem) => {
    setCurrItem(item)
    setIsShowViewModal(true)
  }

  const handleSave = async (question: string, answer: string) => {
    if (!currItem) return
    await editAnnotation(appDetail.id, currItem.id, { question, answer })
    Toast.notify({ message: t('common.api.actionSuccess'), type: 'success' })
    fetchList()
    setControlUpdateList(Date.now())
  }

  useEffect(() => {
    if (!isShowEdit) setControlRefreshSwitch(Date.now())
  }, [isShowEdit])

  return (
    <div className='flex h-full flex-col'>
      <p className='system-sm-regular text-text-tertiary'>{t('appLog.description')}</p>
      <div className='flex h-full flex-1 flex-col py-4'>
        <Filter appId={appDetail.id} queryParams={queryParams} setQueryParams={setQueryParams}>
          <div className='flex items-center space-x-2'>
            {isChatApp && (
              <>
                <div className={cn(!annotationConfig?.enabled && 'pr-2', 'flex h-7 items-center space-x-1 rounded-lg border border-components-panel-border bg-components-panel-bg-blur pl-2')}>
                  <MessageFast className='h-4 w-4 text-util-colors-indigo-indigo-600' />
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
                      <div className='mr-1 h-3.5 w-[1px] shrink-0 bg-divider-subtle'></div>
                      <ActionButton onClick={() => setIsShowEdit(true)}>
                        <RiEqualizer2Line className='h-4 w-4 text-text-tertiary' />
                      </ActionButton>
                    </div>
                  )}
                </div>
                <div className='mx-3 h-3.5 w-[1px] shrink-0 bg-divider-regular'></div>
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
          // eslint-disable-next-line sonarjs/no-nested-conditional
          : total > 0
            ? <List
              list={list}
              onRemove={handleRemove}
              onView={handleView}
              selectedIds={selectedIds}
              onSelectedIdsChange={setSelectedIds}
              onBatchDelete={handleBatchDelete}
              onCancel={() => setSelectedIds([])}
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
