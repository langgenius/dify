import type { ChangeEvent } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiEqualizer2Line,
} from '@remixicon/react'
import Image from 'next/image'
import Button from '../../base/button'
import { getIcon } from '../common/retrieval-method-info'
import ModifyExternalRetrievalModal from './modify-external-retrieval-modal'
import Tooltip from '@/app/components/base/tooltip'
import cn from '@/utils/classnames'
import type { ExternalKnowledgeBaseHitTestingResponse, HitTestingResponse } from '@/models/datasets'
import { externalKnowledgeBaseHitTesting, hitTesting } from '@/service/datasets'
import { asyncRunSafe } from '@/utils'
import { RETRIEVE_METHOD, type RetrievalConfig } from '@/types/app'

type TextAreaWithButtonIProps = {
  datasetId: string
  onUpdateList: () => void
  setHitResult: (res: HitTestingResponse) => void
  setExternalHitResult: (res: ExternalKnowledgeBaseHitTestingResponse) => void
  loading: boolean
  setLoading: (v: boolean) => void
  text: string
  setText: (v: string) => void
  isExternal?: boolean
  onClickRetrievalMethod: () => void
  retrievalConfig: RetrievalConfig
  isEconomy: boolean
  onSubmit?: () => void
}

const TextAreaWithButton = ({
  datasetId,
  onUpdateList,
  setHitResult,
  setExternalHitResult,
  setLoading,
  loading,
  text,
  setText,
  isExternal = false,
  onClickRetrievalMethod,
  retrievalConfig,
  isEconomy,
  onSubmit: _onSubmit,
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
    setLoading(true)
    const [e, res] = await asyncRunSafe<HitTestingResponse>(
      hitTesting({
        datasetId,
        queryText: text,
        retrieval_model: {
          ...retrievalConfig,
          search_method: isEconomy ? RETRIEVE_METHOD.keywordSearch : retrievalConfig.search_method,
        },
      }) as Promise<HitTestingResponse>,
    )
    if (!e) {
      setHitResult(res)
      onUpdateList?.()
    }
    setLoading(false)
    if (_onSubmit)
      _onSubmit()
  }

  const externalRetrievalTestingOnSubmit = async () => {
    setLoading(true)
    const [e, res] = await asyncRunSafe<ExternalKnowledgeBaseHitTestingResponse>(
      externalKnowledgeBaseHitTesting({
        datasetId,
        query: text,
        external_retrieval_model: {
          top_k: externalRetrievalSettings.top_k,
          score_threshold: externalRetrievalSettings.score_threshold,
          score_threshold_enabled: externalRetrievalSettings.score_threshold_enabled,
        },
      }) as Promise<ExternalKnowledgeBaseHitTestingResponse>,
    )
    if (!e) {
      setExternalHitResult(res)
      onUpdateList?.()
    }
    setLoading(false)
  }

  const retrievalMethod = isEconomy ? RETRIEVE_METHOD.keywordSearch : retrievalConfig.search_method
  const icon = <Image className='size-3.5 text-util-colors-purple-purple-600' src={getIcon(retrievalMethod)} alt='' />
  return (
    <>
      <div className={cn('relative rounded-xl bg-gradient-to-r from-components-input-border-active-prompt-1 to-components-input-border-active-prompt-2 p-0.5 shadow-xs')}>
        <div className='relative rounded-t-xl bg-background-section-burn pt-1.5'>
          <div className="flex h-8 items-center justify-between pb-1 pl-4 pr-1.5">
            <span className="text-[13px] font-semibold uppercase leading-4 text-text-secondary">
              {t('datasetHitTesting.input.title')}
            </span>
            {isExternal
              ? <Button
                variant='secondary'
                size='small'
                onClick={() => setIsSettingsOpen(!isSettingsOpen)}
              >
                <RiEqualizer2Line className='h-3.5 w-3.5 text-components-button-secondary-text' />
                <div className='flex items-center justify-center gap-1 px-[3px]'>
                  <span className='system-xs-medium text-components-button-secondary-text'>{t('datasetHitTesting.settingTitle')}</span>
                </div>
              </Button>
              : <div
                onClick={onClickRetrievalMethod}
                className='flex h-7 cursor-pointer items-center space-x-0.5 rounded-lg border-[0.5px] border-components-button-secondary-bg bg-components-button-secondary-bg px-1.5 shadow-xs backdrop-blur-[5px] hover:bg-components-button-secondary-bg-hover'
              >
                {icon}
                <div className='text-xs font-medium uppercase text-text-secondary'>{t(`dataset.retrieval.${retrievalMethod}.title`)}</div>
                <RiEqualizer2Line className='size-4 text-components-menu-item-text'></RiEqualizer2Line>
              </div>
            }
          </div>
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
          <div className='h-2 rounded-t-xl bg-background-default'></div>
        </div>
        <div className='rounded-b-xl bg-background-default px-4 pb-11'>
          <textarea
            className='h-[220px] w-full resize-none border-none bg-transparent text-sm font-normal text-text-secondary caret-[#295EFF]  placeholder:text-sm placeholder:font-normal placeholder:text-components-input-text-placeholder focus-visible:outline-none'
            value={text}
            onChange={handleTextChange}
            placeholder={t('datasetHitTesting.input.placeholder') as string}
          />
          <div className="absolute inset-x-0 bottom-0 mx-4 mb-2 mt-2 flex items-center justify-between">
            {text?.length > 200
              ? (
                <Tooltip
                  popupContent={t('datasetHitTesting.input.countWarning')}
                >
                  <div
                    className={cn('flex h-5 items-center rounded-md bg-background-section-burn px-1 text-xs font-medium text-red-600', !text?.length && 'opacity-50')}
                  >
                    {text?.length}
                    <span className="mx-0.5 text-red-300">/</span>
                    200
                  </div>
                </Tooltip>
              )
              : (
                <div
                  className={cn('flex h-5 items-center rounded-md bg-background-section-burn px-1 text-xs font-medium text-text-tertiary', !text?.length && 'opacity-50')}
                >
                  {text?.length}
                  <span className="mx-0.5 text-divider-deep">/</span>
                  200
                </div>
              )}

            <div>
              <Button
                onClick={isExternal ? externalRetrievalTestingOnSubmit : onSubmit}
                variant="primary"
                loading={loading}
                disabled={(!text?.length || text?.length > 200)}
                className='w-[88px]'
              >
                {t('datasetHitTesting.input.testing')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

export default TextAreaWithButton
