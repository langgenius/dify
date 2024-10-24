import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiEqualizer2Line,
} from '@remixicon/react'
import Button from '../../base/button'
import Tag from '../../base/tag'
import { getIcon } from '../common/retrieval-method-info'
import s from './style.module.css'
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
  const Icon = getIcon(retrievalMethod)
  return (
    <>
      <div className={s.wrapper}>
        <div className='relative pt-2 rounded-tl-xl rounded-tr-xl bg-[#EEF4FF]'>
          <div className="px-4 pb-2 flex justify-between h-8 items-center">
            <span className="text-gray-800 font-semibold text-sm">
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
              : <Tooltip
                popupContent={t('dataset.retrieval.changeRetrievalMethod')}
              >
                <div
                  onClick={onClickRetrievalMethod}
                  className='flex px-2 h-7 items-center space-x-1 bg-white hover:bg-[#ECE9FE] rounded-md shadow-sm cursor-pointer text-[#6927DA]'
                >
                  <Icon className='w-3.5 h-3.5'></Icon>
                  <div className='text-xs font-medium'>{t(`dataset.retrieval.${retrievalMethod}.title`)}</div>
                </div>
              </Tooltip>
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
          <div className='h-2 rounded-tl-xl rounded-tr-xl bg-white'></div>
        </div>
        <div className='px-4 pb-11'>
          <textarea
            className='h-[220px] border-none resize-none font-normal caret-primary-600 text-gray-700 text-sm w-full focus-visible:outline-none placeholder:text-gray-300 placeholder:text-sm placeholder:font-normal'
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
                  <div>
                    <Tag color="red" className="!text-red-600">
                      {text?.length}
                      <span className="text-red-300 mx-0.5">/</span>
                      200
                    </Tag>
                  </div>
                </Tooltip>
              )
              : (
                <Tag
                  color="gray"
                  className={cn('!text-gray-500', text?.length ? '' : 'opacity-50')}
                >
                  {text?.length}
                  <span className="text-gray-300 mx-0.5">/</span>
                  200
                </Tag>
              )}

            <div>
              <Button
                onClick={isExternal ? externalRetrievalTestingOnSubmit : onSubmit}
                variant="primary"
                loading={loading}
                disabled={(!text?.length || text?.length > 200)}
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
