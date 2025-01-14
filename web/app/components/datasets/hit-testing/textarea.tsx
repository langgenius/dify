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
import promptS from '@/app/components/app/configuration/config-prompt/style.module.css'

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
    top_k: 2,
    score_threshold: 0.5,
    score_threshold_enabled: false,
  })

  const handleSaveExternalRetrievalSettings = (data: { top_k: number; score_threshold: number; score_threshold_enabled: boolean }) => {
    setExternalRetrievalSettings(data)
    setIsSettingsOpen(false)
  }

  function handleTextChange(event: any) {
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
    _onSubmit && _onSubmit()
  }

  const externalRetrievalTestingOnSubmit = async () => {
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

  const retrievalMethod = isEconomy ? RETRIEVE_METHOD.invertedIndex : retrievalConfig.search_method
  const icon = <Image className='size-3.5 text-util-colors-purple-purple-600' src={getIcon(retrievalMethod)} alt='' />
  return (
    <>
      <div className={cn('relative rounded-xl', promptS.gradientBorder)}>
        <div className='relative pt-1.5 rounded-tl-xl rounded-tr-xl bg-background-section-burn'>
          <div className="pl-4 pr-1.5 pb-1 flex justify-between h-8 items-center">
            <span className="text-text-secondary font-semibold text-[13px] leading-4 uppercase">
              {t('datasetHitTesting.input.title')}
            </span>
            {isExternal
              ? <Button
                variant='secondary'
                size='small'
                onClick={() => setIsSettingsOpen(!isSettingsOpen)}
              >
                <RiEqualizer2Line className='text-components-button-secondary-text w-3.5 h-3.5' />
                <div className='flex px-[3px] justify-center items-center gap-1'>
                  <span className='text-components-button-secondary-text system-xs-medium'>{t('datasetHitTesting.settingTitle')}</span>
                </div>
              </Button>
              : <div
                onClick={onClickRetrievalMethod}
                className='flex px-1.5 h-7 items-center bg-components-button-secondary-bg hover:bg-components-button-secondary-bg-hover rounded-lg border-[0.5px] border-components-button-secondary-bg shadow-xs backdrop-blur-[5px] cursor-pointer space-x-0.5'
              >
                {icon}
                <div className='text-text-secondary text-xs font-medium uppercase'>{t(`dataset.retrieval.${retrievalMethod}.title`)}</div>
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
          <div className='h-2 rounded-tl-xl rounded-tr-xl bg-background-default'></div>
        </div>
        <div className='px-4 pb-11 bg-background-default rounded-b-xl'>
          <textarea
            className='h-[220px] border-none resize-none font-normal caret-primary-600 text-text-secondary text-sm w-full focus-visible:outline-none  placeholder:text-gray-300 placeholder:text-sm placeholder:font-normal'
            value={text}
            onChange={handleTextChange}
            placeholder={t('datasetHitTesting.input.placeholder') as string}
          />
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between mx-4 mt-2 mb-2">
            {text?.length > 200
              ? (
                <Tooltip
                  popupContent={t('datasetHitTesting.input.countWarning')}
                >
                  <div
                    className={cn('flex items-center h-5 px-1 rounded-md bg-background-section-burn text-red-600 text-xs font-medium', !text?.length && 'opacity-50')}
                  >
                    {text?.length}
                    <span className="text-red-300 mx-0.5">/</span>
                    200
                  </div>
                </Tooltip>
              )
              : (
                <div
                  className={cn('flex items-center h-5 px-1 rounded-md bg-background-section-burn text-text-tertiary text-xs font-medium', !text?.length && 'opacity-50')}
                >
                  {text?.length}
                  <span className="text-divider-deep mx-0.5">/</span>
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
