'use client'
import type { FC } from 'react'
import type {
  ExternalKnowledgeBaseHitTesting,
  ExternalKnowledgeBaseHitTestingResponse,
  HitTesting,
  HitTestingRecord,
  HitTestingResponse,
  Query,
} from '@/models/datasets'
import type { RetrievalConfig } from '@/types/app'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import Drawer from '@/app/components/base/drawer'
import FloatRightContainer from '@/app/components/base/float-right-container'
import Loading from '@/app/components/base/loading'
import Pagination from '@/app/components/base/pagination'
import docStyle from '@/app/components/datasets/documents/detail/completed/style.module.css'
import DatasetDetailContext from '@/context/dataset-detail'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { useDatasetTestingRecords } from '@/service/knowledge/use-dataset'
import {
  useExternalKnowledgeBaseHitTesting,
  useHitTesting,
} from '@/service/knowledge/use-hit-testing'
import { cn } from '@/utils/classnames'
import { CardSkelton } from '../documents/detail/completed/skeleton/general-list-skeleton'
import EmptyRecords from './components/empty-records'
import QueryInput from './components/query-input'
import Records from './components/records'
import ResultItem from './components/result-item'
import ResultItemExternal from './components/result-item-external'
import ModifyRetrievalModal from './modify-retrieval-modal'

const limit = 10

type Props = {
  datasetId: string
}

const HitTestingPage: FC<Props> = ({ datasetId }: Props) => {
  const { t } = useTranslation()

  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile

  const [hitResult, setHitResult] = useState<HitTestingResponse | undefined>()
  const [externalHitResult, setExternalHitResult] = useState<ExternalKnowledgeBaseHitTestingResponse | undefined>()
  const [queries, setQueries] = useState<Query[]>([])
  const [queryInputKey, setQueryInputKey] = useState(Date.now())

  const [currPage, setCurrPage] = useState<number>(0)
  const { data: recordsRes, refetch: recordsRefetch, isLoading: isRecordsLoading } = useDatasetTestingRecords(datasetId, { limit, page: currPage + 1 })

  const total = recordsRes?.total || 0

  const { dataset: currentDataset } = useContext(DatasetDetailContext)
  const isExternal = currentDataset?.provider === 'external'

  const [retrievalConfig, setRetrievalConfig] = useState(currentDataset?.retrieval_model_dict as RetrievalConfig)
  const [isShowModifyRetrievalModal, setIsShowModifyRetrievalModal] = useState(false)
  const [isShowRightPanel, { setTrue: showRightPanel, setFalse: hideRightPanel, set: setShowRightPanel }] = useBoolean(!isMobile)

  const { mutateAsync: hitTestingMutation, isPending: isHitTestingPending } = useHitTesting(datasetId)
  const {
    mutateAsync: externalKnowledgeBaseHitTestingMutation,
    isPending: isExternalKnowledgeBaseHitTestingPending,
  } = useExternalKnowledgeBaseHitTesting(datasetId)

  const isRetrievalLoading = isHitTestingPending || isExternalKnowledgeBaseHitTestingPending

  const renderHitResults = (results: HitTesting[] | ExternalKnowledgeBaseHitTesting[]) => (
    <div className="flex h-full flex-col rounded-tl-2xl bg-background-body px-4 py-3">
      <div className="mb-2 shrink-0 pl-2 font-semibold leading-6 text-text-primary">
        {t('hit.title', { ns: 'datasetHitTesting', num: results.length })}
      </div>
      <div className="grow space-y-2 overflow-y-auto">
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
    <div className="flex h-full flex-col items-center justify-center rounded-tl-2xl bg-background-body px-4 py-3">
      <div className={cn(docStyle.commonIcon, docStyle.targetIcon, '!h-14 !w-14 !bg-text-quaternary')} />
      <div className="mt-3 text-[13px] text-text-quaternary">
        {t('hit.emptyTip', { ns: 'datasetHitTesting' })}
      </div>
    </div>
  )

  const handleClickRecord = useCallback((record: HitTestingRecord) => {
    setQueries(record.queries)
    setQueryInputKey(Date.now())
  }, [])

  useEffect(() => {
    setShowRightPanel(!isMobile)
  }, [isMobile, setShowRightPanel])

  return (
    <div className="relative flex h-full w-full gap-x-6 overflow-y-auto pl-6">
      <div className="flex min-w-0 flex-1 flex-col py-3">
        <div className="mb-4 flex flex-col justify-center">
          <h1 className="text-base font-semibold text-text-primary">{t('title', { ns: 'datasetHitTesting' })}</h1>
          <p className="mt-0.5 text-[13px] font-normal leading-4 text-text-tertiary">{t('desc', { ns: 'datasetHitTesting' })}</p>
        </div>
        <QueryInput
          key={queryInputKey}
          setHitResult={setHitResult}
          setExternalHitResult={setExternalHitResult}
          onSubmit={showRightPanel}
          onUpdateList={recordsRefetch}
          loading={isRetrievalLoading}
          queries={queries}
          setQueries={setQueries}
          isExternal={isExternal}
          onClickRetrievalMethod={() => setIsShowModifyRetrievalModal(true)}
          retrievalConfig={retrievalConfig}
          isEconomy={currentDataset?.indexing_technique === 'economy'}
          hitTestingMutation={hitTestingMutation}
          externalKnowledgeBaseHitTestingMutation={externalKnowledgeBaseHitTestingMutation}
        />
        <div className="mb-3 mt-6 text-base font-semibold text-text-primary">{t('records', { ns: 'datasetHitTesting' })}</div>
        {isRecordsLoading && (
          <div className="flex-1"><Loading type="app" /></div>
        )}
        {!isRecordsLoading && recordsRes?.data && recordsRes.data.length > 0 && (
          <>
            <Records records={recordsRes?.data} onClickRecord={handleClickRecord} />
            {(total && total > limit)
              ? <Pagination current={currPage} onChange={setCurrPage} total={total} limit={limit} />
              : null}
          </>
        )}
        {!isRecordsLoading && !recordsRes?.data?.length && (
          <EmptyRecords />
        )}
      </div>
      <FloatRightContainer
        panelClassName="!justify-start !overflow-y-auto"
        showClose
        isMobile={isMobile}
        isOpen={isShowRightPanel}
        onClose={hideRightPanel}
        footer={null}
      >
        <div className="flex min-w-0 flex-1 flex-col pt-3">
          {isRetrievalLoading
            ? (
                <div className="flex h-full flex-col rounded-tl-2xl bg-background-body px-4 py-3">
                  <CardSkelton />
                </div>
              )
            : (
                (() => {
                  if (!hitResult?.records.length && !externalHitResult?.records.length)
                    return renderEmptyState()

                  if (hitResult?.records.length)
                    return renderHitResults(hitResult.records)

                  return renderHitResults(externalHitResult?.records || [])
                })()
              )}
        </div>
      </FloatRightContainer>
      <Drawer
        unmount={true}
        isOpen={isShowModifyRetrievalModal}
        onClose={() => setIsShowModifyRetrievalModal(false)}
        footer={null}
        mask={isMobile}
        panelClassName="mt-16 mx-2 sm:mr-2 mb-3 !p-0 !max-w-[640px] rounded-xl"
      >
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
