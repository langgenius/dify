'use client'
import type { FC } from 'react'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'
import { omit } from 'lodash-es'
import { useBoolean } from 'ahooks'
import { useContext } from 'use-context-selector'
import { RiApps2Line, RiFocus2Line, RiHistoryLine } from '@remixicon/react'
import Textarea from './textarea'
import s from './style.module.css'
import ModifyRetrievalModal from './modify-retrieval-modal'
import ResultItem from './components/result-item'
import ResultItemExternal from './components/result-item-external'
import cn from '@/utils/classnames'
import type { ExternalKnowledgeBaseHitTesting, ExternalKnowledgeBaseHitTestingResponse, HitTesting, HitTestingResponse } from '@/models/datasets'
import Loading from '@/app/components/base/loading'
import Drawer from '@/app/components/base/drawer'
import Pagination from '@/app/components/base/pagination'
import FloatRightContainer from '@/app/components/base/float-right-container'
import { fetchTestingRecords } from '@/service/datasets'
import DatasetDetailContext from '@/context/dataset-detail'
import type { RetrievalConfig } from '@/types/app'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import useTimestamp from '@/hooks/use-timestamp'
import docStyle from '@/app/components/datasets/documents/detail/completed/style.module.css'
import { CardSkelton } from '../documents/detail/completed/skeleton/general-list-skeleton'

const limit = 10

type Props = {
  datasetId: string
}

const RecordsEmpty: FC = () => {
  const { t } = useTranslation()
  return <div className='rounded-2xl bg-workflow-process-bg p-5'>
    <div className='flex h-10 w-10 items-center justify-center rounded-[10px] border-[0.5px] border-components-card-border bg-components-card-bg p-1 shadow-lg shadow-shadow-shadow-5 backdrop-blur-[5px]'>
      <RiHistoryLine className='h-5 w-5 text-text-tertiary' />
    </div>
    <div className='my-2 text-[13px] font-medium leading-4 text-text-tertiary'>{t('datasetHitTesting.noRecentTip')}</div>
  </div>
}

const HitTestingPage: FC<Props> = ({ datasetId }: Props) => {
  const { t } = useTranslation()
  const { formatTime } = useTimestamp()

  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile

  const [hitResult, setHitResult] = useState<HitTestingResponse | undefined>() // 初始化记录为空数组
  const [externalHitResult, setExternalHitResult] = useState<ExternalKnowledgeBaseHitTestingResponse | undefined>()
  const [submitLoading, setSubmitLoading] = useState(false)
  const [text, setText] = useState('')

  const [currPage, setCurrPage] = React.useState<number>(0)
  const { data: recordsRes, error, mutate: recordsMutate } = useSWR({
    action: 'fetchTestingRecords',
    datasetId,
    params: { limit, page: currPage + 1 },
  }, apiParams => fetchTestingRecords(omit(apiParams, 'action')))

  const total = recordsRes?.total || 0

  const { dataset: currentDataset } = useContext(DatasetDetailContext)
  const isExternal = currentDataset?.provider === 'external'

  const [retrievalConfig, setRetrievalConfig] = useState(currentDataset?.retrieval_model_dict as RetrievalConfig)
  const [isShowModifyRetrievalModal, setIsShowModifyRetrievalModal] = useState(false)
  const [isShowRightPanel, { setTrue: showRightPanel, setFalse: hideRightPanel, set: setShowRightPanel }] = useBoolean(!isMobile)
  const renderHitResults = (results: HitTesting[] | ExternalKnowledgeBaseHitTesting[]) => (
    <div className='flex h-full flex-col rounded-t-2xl bg-background-body px-4 py-3'>
      <div className='mb-2 shrink-0 pl-2 font-semibold leading-6 text-text-primary'>
        {t('datasetHitTesting.hit.title', { num: results.length })}
      </div>
      <div className='grow space-y-2 overflow-y-auto'>
        {results.map((record, idx) =>
          isExternal
            ? (
              <ResultItemExternal
                key={idx}
                positionId={idx + 1}
                payload={record as ExternalKnowledgeBaseHitTesting}
              />
            )
            : (
              <ResultItem key={idx} payload={record as HitTesting} />
            ),
        )}
      </div>
    </div>
  )

  const renderEmptyState = () => (
    <div className='flex h-full flex-col items-center justify-center rounded-t-2xl bg-background-body px-4 py-3'>
      <div className={cn(docStyle.commonIcon, docStyle.targetIcon, '!h-14 !w-14 !bg-text-quaternary')} />
      <div className='mt-3 text-[13px] text-text-quaternary'>
        {t('datasetHitTesting.hit.emptyTip')}
      </div>
    </div>
  )

  useEffect(() => {
    setShowRightPanel(!isMobile)
  }, [isMobile, setShowRightPanel])

  return (
    <div className={s.container}>
      <div className='flex flex-col px-6 py-3'>
        <div className='mb-4 flex flex-col justify-center'>
          <h1 className='text-base font-semibold text-text-primary'>{t('datasetHitTesting.title')}</h1>
          <p className='mt-0.5 text-[13px] font-normal leading-4 text-text-tertiary'>{t('datasetHitTesting.desc')}</p>
        </div>
        <Textarea
          datasetId={datasetId}
          setHitResult={setHitResult}
          setExternalHitResult={setExternalHitResult}
          onSubmit={showRightPanel}
          onUpdateList={recordsMutate}
          loading={submitLoading}
          setLoading={setSubmitLoading}
          setText={setText}
          text={text}
          isExternal={isExternal}
          onClickRetrievalMethod={() => setIsShowModifyRetrievalModal(true)}
          retrievalConfig={retrievalConfig}
          isEconomy={currentDataset?.indexing_technique === 'economy'}
        />
        <div className='mb-3 mt-6 text-base font-semibold text-text-primary'>{t('datasetHitTesting.records')}</div>
        {(!recordsRes && !error)
          ? (
            <div className='flex-1'><Loading type='app' /></div>
          )
          : recordsRes?.data?.length
            ? (
              <>
                <div className='grow overflow-y-auto'>
                  <table className={'w-full border-collapse border-0 text-[13px] leading-4 text-text-secondary '}>
                    <thead className='sticky top-0 h-7 text-xs  font-medium uppercase leading-7 text-text-tertiary'>
                      <tr>
                        <td className='w-[128px] rounded-l-lg bg-background-section-burn pl-3'>{t('datasetHitTesting.table.header.source')}</td>
                        <td className='bg-background-section-burn'>{t('datasetHitTesting.table.header.text')}</td>
                        <td className='w-48 rounded-r-lg bg-background-section-burn pl-2'>{t('datasetHitTesting.table.header.time')}</td>
                      </tr>
                    </thead>
                    <tbody>
                      {recordsRes?.data?.map((record) => {
                        const SourceIcon = record.source === 'app' ? RiApps2Line : RiFocus2Line
                        return <tr
                          key={record.id}
                          className='group h-10 cursor-pointer border-b border-divider-subtle hover:bg-background-default-hover'
                          onClick={() => setText(record.content)}
                        >
                          <td className='w-[128px] pl-3'>
                            <div className='flex items-center'>
                              <SourceIcon className='mr-1 size-4 text-text-tertiary' />
                              <span className='capitalize'>{record.source.replace('_', ' ').replace('hit testing', 'retrieval test')}</span>
                            </div>
                          </td>
                          <td className='max-w-xs py-2'>{record.content}</td>
                          <td className='w-36 pl-2'>
                            {formatTime(record.created_at, t('datasetHitTesting.dateTimeFormat') as string)}
                          </td>
                        </tr>
                      })}
                    </tbody>
                  </table>
                </div>
                {(total && total > limit)
                  ? <Pagination current={currPage} onChange={setCurrPage} total={total} limit={limit} />
                  : null}
              </>
            )
            : (
              <RecordsEmpty />
            )}
      </div>
      <FloatRightContainer panelClassname='!justify-start !overflow-y-auto' showClose isMobile={isMobile} isOpen={isShowRightPanel} onClose={hideRightPanel} footer={null}>
        <div className='flex flex-col pt-3'>
          {/* {renderHitResults(generalResultData)} */}
          {submitLoading
            ? <div className='flex h-full flex-col rounded-t-2xl bg-background-body px-4 py-3'>
              <CardSkelton />
            </div>
            : (
              (() => {
                if (!hitResult?.records.length && !externalHitResult?.records.length)
                  return renderEmptyState()

                if (hitResult?.records.length)
                  return renderHitResults(hitResult.records)

                return renderHitResults(externalHitResult?.records || [])
              })()
            )
          }
        </div>
      </FloatRightContainer>
      <Drawer unmount={true} isOpen={isShowModifyRetrievalModal} onClose={() => setIsShowModifyRetrievalModal(false)} footer={null} mask={isMobile} panelClassname='mt-16 mx-2 sm:mr-2 mb-3 !p-0 !max-w-[640px] rounded-xl'>
        <ModifyRetrievalModal
          indexMethod={currentDataset?.indexing_technique || ''}
          value={retrievalConfig}
          isShow={isShowModifyRetrievalModal}
          onHide={() => setIsShowModifyRetrievalModal(false)}
          onSave={(value) => {
            setRetrievalConfig(value)
            setIsShowModifyRetrievalModal(false)
          }}
        />
      </Drawer>
    </div>
  )
}

export default HitTestingPage
