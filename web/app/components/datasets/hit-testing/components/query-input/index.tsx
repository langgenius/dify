import type { ChangeEvent } from 'react'
import React, { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiEqualizer2Line,
  RiPlayCircleLine,
} from '@remixicon/react'
import Image from 'next/image'
import Button from '@/app/components/base/button'
import { getIcon } from '@/app/components/datasets/common/retrieval-method-info'
import ModifyExternalRetrievalModal from '@/app/components/datasets/hit-testing/modify-external-retrieval-modal'
import cn from '@/utils/classnames'
import type {
  ExternalKnowledgeBaseHitTestingRequest,
  ExternalKnowledgeBaseHitTestingResponse,
  HitTestingRequest,
  HitTestingResponse,
  Query,
} from '@/models/datasets'
import { RETRIEVE_METHOD, type RetrievalConfig } from '@/types/app'
import type { UseMutateAsyncFunction } from '@tanstack/react-query'
import ImageUploaderInRetrievalTesting from '@/app/components/datasets/common/image-uploader/image-uploader-in-retrieval-testing'
import Textarea from './textarea'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { produce } from 'immer'
import type { FileEntity } from '@/app/components/datasets/common/image-uploader/types'
import { v4 as uuid4 } from 'uuid'

type QueryInputProps = {
  onUpdateList: () => void
  setHitResult: (res: HitTestingResponse) => void
  setExternalHitResult: (res: ExternalKnowledgeBaseHitTestingResponse) => void
  loading: boolean
  queries: Query[]
  setQueries: (v: Query[]) => void
  isExternal?: boolean
  onClickRetrievalMethod: () => void
  retrievalConfig: RetrievalConfig
  isEconomy: boolean
  onSubmit?: () => void
  hitTestingMutation: UseMutateAsyncFunction<HitTestingResponse, Error, HitTestingRequest, unknown>
  externalKnowledgeBaseHitTestingMutation: UseMutateAsyncFunction<
    ExternalKnowledgeBaseHitTestingResponse,
    Error,
    ExternalKnowledgeBaseHitTestingRequest,
    unknown
  >
}

const QueryInput = ({
  onUpdateList,
  setHitResult,
  setExternalHitResult,
  loading,
  queries,
  setQueries,
  isExternal = false,
  onClickRetrievalMethod,
  retrievalConfig,
  isEconomy,
  onSubmit: _onSubmit,
  hitTestingMutation,
  externalKnowledgeBaseHitTestingMutation,
}: QueryInputProps) => {
  const { t } = useTranslation()
  const isMultimodal = useDatasetDetailContextWithSelector(s => !!s.dataset?.is_multimodal)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [externalRetrievalSettings, setExternalRetrievalSettings] = useState({
    top_k: 4,
    score_threshold: 0.5,
    score_threshold_enabled: false,
  })
  const [initialImages] = useState<FileEntity[]>(() => {
    return queries.filter(query => query.content_type === 'image_query').map(query => query.file_info!).map(item => ({
      id: uuid4(),
      name: item.name,
      size: item.size,
      mimeType: item.mime_type,
      extension: item.extension,
      sourceUrl: item.source_url,
      uploadedId: item.id,
      progress: 100,
    })) || []
  })

  const text = useMemo(() => {
    return queries.find(query => query.content_type === 'text_query')?.content ?? ''
  }, [queries])

  const handleSaveExternalRetrievalSettings = useCallback((data: {
    top_k: number
    score_threshold: number
    score_threshold_enabled: boolean
  }) => {
    setExternalRetrievalSettings(data)
    setIsSettingsOpen(false)
  }, [])

  const handleTextChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    const newQueries = produce(queries, (draft) => {
      draft.find(query => query.content_type === 'text_query')!.content = event.target.value
    })
    setQueries(newQueries)
  }, [queries, setQueries])

  const onSubmit = useCallback(async () => {
    await hitTestingMutation({
      query: text,
      attachment_ids: [],
      retrieval_model: {
        ...retrievalConfig,
        search_method: isEconomy ? RETRIEVE_METHOD.keywordSearch : retrievalConfig.search_method,
      },
    }, {
      onSuccess: (data) => {
        setHitResult(data)
        onUpdateList?.()
        if (_onSubmit)
          _onSubmit()
      },
    })
  }, [text, retrievalConfig, isEconomy, hitTestingMutation, onUpdateList, _onSubmit])

  const externalRetrievalTestingOnSubmit = useCallback(async () => {
    await externalKnowledgeBaseHitTestingMutation({
      query: text,
      external_retrieval_model: {
        top_k: externalRetrievalSettings.top_k,
        score_threshold: externalRetrievalSettings.score_threshold,
        score_threshold_enabled: externalRetrievalSettings.score_threshold_enabled,
      },
    }, {
      onSuccess: (data) => {
        setExternalHitResult(data)
        onUpdateList?.()
      },
    })
  }, [text, externalRetrievalSettings, externalKnowledgeBaseHitTestingMutation, onUpdateList])

  const retrievalMethod = isEconomy ? RETRIEVE_METHOD.keywordSearch : retrievalConfig.search_method
  const icon = <Image className='size-3.5 text-util-colors-purple-purple-600' src={getIcon(retrievalMethod)} alt='' />
  const TextAreaComp = useMemo(() => {
    return <Textarea
      text={text}
      handleTextChange={handleTextChange}
    />
  }, [text, handleTextChange])
  const ActionButtonComp = useMemo(() => {
    return (
      <Button
        onClick={isExternal ? externalRetrievalTestingOnSubmit : onSubmit}
        variant='primary'
        loading={loading}
        disabled={(!text?.length || text?.length > 200)}
        className='w-[88px]'
      >
        <RiPlayCircleLine className='mr-1 size-4' />
        {t('datasetHitTesting.input.testing')}
      </Button>
    )
  }, [isExternal, externalRetrievalTestingOnSubmit, onSubmit, text, loading, t])

  return (
    <div className={cn('relative flex h-80 flex-col overflow-hidden rounded-xl bg-gradient-to-r from-components-input-border-active-prompt-1 to-components-input-border-active-prompt-2 p-0.5 shadow-xs')}>
      <div className='flex h-full flex-col overflow-hidden rounded-[10px] bg-background-section-burn'>
        <div className='relative flex shrink-0 items-center justify-between p-1.5 pb-1 pl-3'>
          <span className='system-sm-semibold-uppercase text-text-secondary'>
            {t('datasetHitTesting.input.title')}
          </span>
          {isExternal ? (
            <Button
              variant='secondary'
              size='small'
              onClick={() => setIsSettingsOpen(!isSettingsOpen)}
            >
              <RiEqualizer2Line className='h-3.5 w-3.5 text-components-button-secondary-text' />
              <div className='flex items-center justify-center gap-1 px-[3px]'>
                <span className='system-xs-medium text-components-button-secondary-text'>{t('datasetHitTesting.settingTitle')}</span>
              </div>
            </Button>
          ) : (
            <div
              onClick={onClickRetrievalMethod}
              className='flex h-7 cursor-pointer items-center space-x-0.5 rounded-lg border-[0.5px] border-components-button-secondary-bg bg-components-button-secondary-bg px-1.5 shadow-xs backdrop-blur-[5px] hover:bg-components-button-secondary-bg-hover'
            >
              {icon}
              <div className='text-xs font-medium uppercase text-text-secondary'>{t(`dataset.retrieval.${retrievalMethod}.title`)}</div>
              <RiEqualizer2Line className='size-4 text-components-menu-item-text'></RiEqualizer2Line>
            </div>
          )}
          {
            isSettingsOpen && (
              <ModifyExternalRetrievalModal
                onClose={() => setIsSettingsOpen(false)}
                onSave={handleSaveExternalRetrievalSettings}
                initialTopK={externalRetrievalSettings.top_k}
                initialScoreThreshold={externalRetrievalSettings.score_threshold}
                initialScoreThresholdEnabled={externalRetrievalSettings.score_threshold_enabled}
              />
            )
          }
        </div>
        <ImageUploaderInRetrievalTesting
          textArea={TextAreaComp}
          actionButton={ActionButtonComp}
          onChange={(files) => {
            console.log(files)
          }}
          value={initialImages}
          showUploader={isMultimodal}
          className='grow'
          actionAreaClassName='px-4 py-2 shrink-0 bg-background-default'
        />
      </div>
    </div>
  )
}

export default QueryInput
