import type { ChangeEvent } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiEqualizer2Line,
  RiPlayCircleLine,
} from '@remixicon/react'
import Image from 'next/image'
import Button from '../../base/button'
import { getIcon } from '../common/retrieval-method-info'
import ModifyExternalRetrievalModal from './modify-external-retrieval-modal'
import Tooltip from '@/app/components/base/tooltip'
import cn from '@/utils/classnames'
import type { ExternalKnowledgeBaseHitTestingRequest, ExternalKnowledgeBaseHitTestingResponse, HitTestingRequest, HitTestingResponse } from '@/models/datasets'
import { RETRIEVE_METHOD, type RetrievalConfig } from '@/types/app'
import type { UseMutateAsyncFunction } from '@tanstack/react-query'
import { CornerShape } from '../../base/icons/src/vender/knowledge'

type TextAreaWithButtonIProps = {
  onUpdateList: () => void
  setHitResult: (res: HitTestingResponse) => void
  setExternalHitResult: (res: ExternalKnowledgeBaseHitTestingResponse) => void
  loading: boolean
  text: string
  setText: (v: string) => void
  isExternal?: boolean
  onClickRetrievalMethod: () => void
  retrievalConfig: RetrievalConfig
  isEconomy: boolean
  onSubmit?: () => void
  hitTestingMutation: UseMutateAsyncFunction<HitTestingResponse, Error, HitTestingRequest, unknown>
  externalKnowledgeBaseHitTestingMutation: UseMutateAsyncFunction<ExternalKnowledgeBaseHitTestingResponse, Error, ExternalKnowledgeBaseHitTestingRequest, unknown>
}

const TextAreaWithButton = ({
  onUpdateList,
  setHitResult,
  setExternalHitResult,
  loading,
  text,
  setText,
  isExternal = false,
  onClickRetrievalMethod,
  retrievalConfig,
  isEconomy,
  onSubmit: _onSubmit,
  hitTestingMutation,
  externalKnowledgeBaseHitTestingMutation,
}: TextAreaWithButtonIProps) => {
  const { t } = useTranslation()
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [externalRetrievalSettings, setExternalRetrievalSettings] = useState({
    top_k: 4,
    score_threshold: 0.5,
    score_threshold_enabled: false,
  })

  const handleSaveExternalRetrievalSettings = (data: { top_k: number; score_threshold: number; score_threshold_enabled: boolean }) => {
    setExternalRetrievalSettings(data)
    setIsSettingsOpen(false)
  }

  function handleTextChange(event: ChangeEvent<HTMLTextAreaElement>) {
    setText(event.target.value)
  }

  const onSubmit = async () => {
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
  }

  const externalRetrievalTestingOnSubmit = async () => {
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
  }

  const retrievalMethod = isEconomy ? RETRIEVE_METHOD.keywordSearch : retrievalConfig.search_method
  const icon = <Image className='size-3.5 text-util-colors-purple-purple-600' src={getIcon(retrievalMethod)} alt='' />
  return (
    <div className={cn('relative flex h-80 flex-col rounded-xl bg-gradient-to-r from-components-input-border-active-prompt-1 to-components-input-border-active-prompt-2 p-0.5 shadow-xs')}>
      <div className='flex h-full flex-col overflow-hidden rounded-xl bg-background-section-burn '>
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
        <div className={cn(
          'relative flex-1 overflow-hidden rounded-t-xl border-t-[0.5px] border-components-panel-border-subtle bg-background-default px-4 pb-11 pt-3',
          text.length > 200 && 'border-state-destructive-active',
        )}>
          <textarea
            className='system-md-regular h-full w-full resize-none border-none bg-transparent text-text-secondary caret-[#295EFF] placeholder:text-components-input-text-placeholder focus-visible:outline-none'
            value={text}
            onChange={handleTextChange}
            placeholder={t('datasetHitTesting.input.placeholder') as string}
          />
          <div className='absolute right-0 top-0 flex items-center'>
            <CornerShape className={cn(
              'text-background-section-burn',
              text.length > 200 && 'text-util-colors-red-red-100',
            )} />
            {text.length > 200
              ? (
                <Tooltip
                  popupContent={t('datasetHitTesting.input.countWarning')}
                >
                  <div
                    className={cn('system-2xs-medium-uppercase bg-util-colors-red-red-100 py-1 pr-2 text-util-colors-red-red-600')}
                  >
                    {`${text.length}/200`}
                  </div>
                </Tooltip>
              )
              : (
                <div
                  className={cn(
                    'system-2xs-medium-uppercase bg-background-section-burn py-1 pr-2 text-text-tertiary',
                  )}
                >
                  {`${text.length}/200`}
                </div>
              )}
          </div>
        </div>
        <div className='flex shrink-0 justify-between bg-background-default px-4 py-2'>
          <div>
            uploader
          </div>
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
        </div>
      </div>
    </div>
  )
}

export default TextAreaWithButton
