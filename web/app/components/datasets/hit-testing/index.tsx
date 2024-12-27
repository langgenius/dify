'use client'
import type { FC } from 'react'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'
import { omit } from 'lodash-es'
import { useBoolean } from 'ahooks'
import { useContext } from 'use-context-selector'
import { RiApps2Line, RiFocus2Line } from '@remixicon/react'
import SegmentCard from '../documents/detail/completed/SegmentCard'
import Textarea from './textarea'
import s from './style.module.css'
import ModifyRetrievalModal from './modify-retrieval-modal'
import ResultItem from './components/result-item'
import cn from '@/utils/classnames'
import type { ExternalKnowledgeBaseHitTestingResponse, HitTestingResponse } from '@/models/datasets'
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

const limit = 10

type Props = {
  datasetId: string
}

const RecordsEmpty: FC = () => {
  const { t } = useTranslation()
  return <div className='bg-gray-50 rounded-2xl p-5'>
    <div className={s.clockWrapper}>
      <div className={cn(s.clockIcon, 'w-5 h-5')}></div>
    </div>
    <div className='my-2 text-gray-500 text-sm'>{t('datasetHitTesting.noRecentTip')}</div>
  </div>
}

const HitTesting: FC<Props> = ({ datasetId }: Props) => {
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
  const renderHitResults = (results: any[]) => (
    <div className='h-full flex flex-col py-3 px-4 rounded-t-2xl bg-background-body'>
      <div className='shrink-0 pl-2 text-text-primary font-semibold leading-6 mb-2'>
        {t('datasetHitTesting.hit.title', { num: results.length })}
      </div>
      <div className='grow overflow-y-auto space-y-2'>
        {results.map((record, idx) => (
          <ResultItem
            key={idx}
            payload={record}
            isExternal={isExternal}
          />
        ))}
      </div>
    </div>
  )

  const renderEmptyState = () => (
    <div className='h-full flex flex-col justify-center items-center py-3 px-4 rounded-t-2xl bg-background-body'>
      <div className={cn(docStyle.commonIcon, docStyle.targetIcon, '!bg-text-quaternary !h-14 !w-14')} />
      <div className='text-text-quaternary text-[13px] mt-3'>
        {t('datasetHitTesting.hit.emptyTip')}
      </div>
    </div>
  )

  useEffect(() => {
    setShowRightPanel(!isMobile)
  }, [isMobile, setShowRightPanel])

  return (
    <div className={s.container}>
      <div className='px-6 py-3 flex flex-col'>
        <div className='flex flex-col justify-center mb-4'>
          <h1 className='text-base font-semibold text-text-primary'>{t('datasetHitTesting.title')}</h1>
          <p className='mt-0.5 text-[13px] leading-4 font-normal text-text-tertiary'>{t('datasetHitTesting.desc')}</p>
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
        <div className='text-base font-semibold text-text-primary mt-6 mb-3'>{t('datasetHitTesting.records')}</div>
        {(!recordsRes && !error)
          ? (
            <div className='flex-1'><Loading type='app' /></div>
          )
          : recordsRes?.data?.length
            ? (
              <>
                <div className='grow overflow-y-auto'>
                  <table className={'w-full border-collapse border-0 text-[13px] leading-4 text-text-secondary '}>
                    <thead className="sticky top-0 h-7 leading-7  text-xs text-text-tertiary font-medium uppercase">
                      <tr>
                        <td className='pl-3 w-[128px] rounded-l-lg bg-background-section-burn'>{t('datasetHitTesting.table.header.source')}</td>
                        <td className='bg-background-section-burn'>{t('datasetHitTesting.table.header.text')}</td>
                        <td className='pl-2 w-48 rounded-r-lg bg-background-section-burn'>{t('datasetHitTesting.table.header.time')}</td>
                      </tr>
                    </thead>
                    <tbody>
                      {recordsRes?.data?.map((record) => {
                        const SourceIcon = record.source === 'app' ? RiApps2Line : RiFocus2Line
                        return <tr
                          key={record.id}
                          className='group border-b border-divider-subtle h-10 hover:bg-background-default-hover cursor-pointer'
                          onClick={() => setText(record.content)}
                        >
                          <td className='pl-3 w-[128px]'>
                            <div className='flex items-center'>
                              <SourceIcon className='mr-1 size-4 text-text-tertiary' />
                              <span className='capitalize'>{record.source.replace('_', ' ').replace('hit testing', 'retrieval test')}</span>
                            </div>
                          </td>
                          <td className='max-w-xs py-2'>{record.content}</td>
                          <td className='pl-2 w-36'>
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
            ? <SegmentCard
              loading={true}
              scene='hitTesting'
              className='h-[216px]'
            />
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
      <Drawer isOpen={isShowModifyRetrievalModal} onClose={() => setIsShowModifyRetrievalModal(false)} footer={null} mask={isMobile} panelClassname='mt-16 mx-2 sm:mr-2 mb-3 !p-0 !max-w-[640px] rounded-xl'>
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

export default HitTesting
