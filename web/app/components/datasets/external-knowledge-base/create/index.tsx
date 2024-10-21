'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { RiArrowLeftLine, RiArrowRightLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import KnowledgeBaseInfo from './KnowledgeBaseInfo'
import ExternalApiSelection from './ExternalApiSelection'
import RetrievalSettings from './RetrievalSettings'
import InfoPanel from './InfoPanel'
import type { CreateKnowledgeBaseReq } from './declarations'
import Divider from '@/app/components/base/divider'
import Button from '@/app/components/base/button'

type ExternalKnowledgeBaseCreateProps = {
  onConnect: (formValue: CreateKnowledgeBaseReq) => void
  loading: boolean
}

const ExternalKnowledgeBaseCreate: React.FC<ExternalKnowledgeBaseCreateProps> = ({ onConnect, loading }) => {
  const { t } = useTranslation()
  const router = useRouter()
  const [formData, setFormData] = useState<CreateKnowledgeBaseReq>({
    name: '',
    description: '',
    external_knowledge_api_id: '',
    external_knowledge_id: '',
    external_retrieval_model: {
      top_k: 2,
      score_threshold: 0.5,
      score_threshold_enabled: false,
    },
    provider: 'external',

  })

  const navBackHandle = useCallback(() => {
    router.replace('/datasets')
  }, [router])

  const handleFormChange = (newData: CreateKnowledgeBaseReq) => {
    setFormData(newData)
  }

  const isFormValid = formData.name.trim() !== ''
    && formData.external_knowledge_api_id !== ''
    && formData.external_knowledge_id !== ''
    && formData.external_retrieval_model.top_k !== undefined
    && formData.external_retrieval_model.score_threshold !== undefined

  return (
    <div className='flex flex-col flex-grow self-stretch rounded-t-2xl border-t border-effects-highlight bg-components-panel-bg'>
      <div className='flex justify-center flex-grow self-stretch'>
        <div className='flex w-full max-w-[960px] px-14 py-0 flex-col items-center'>
          <div className='flex w-full max-w-[640px] pt-6 pb-8 flex-col grow items-center gap-4'>
            <div className='relative flex flex-col py-2 items-center gap-[2px] self-stretch'>
              <div className='flex-grow text-text-primary system-xl-semibold self-stretch'>{t('dataset.connectDataset')}</div>
              <p className='text-text-tertiary system-sm-regular'>
                <span>{t('dataset.connectHelper.helper1')}</span>
                <span className='text-text-secondary system-sm-medium'>{t('dataset.connectHelper.helper2')}</span>
                <span>{t('dataset.connectHelper.helper3')}</span>
                <a className='self-stretch text-text-accent system-sm-regular' href='https://docs.dify.ai/guides/knowledge-base/connect-external-knowledge' target='_blank' rel="noopener noreferrer">
                  {t('dataset.connectHelper.helper4')}
                </a>
                <span>{t('dataset.connectHelper.helper5')} </span>
              </p>
              <Button
                className='flex w-8 h-8 p-2 items-center justify-center absolute left-[-44px] top-1 rounded-full'
                variant='tertiary'
                onClick={navBackHandle}
              >
                <RiArrowLeftLine className='w-4 h-4 text-text-tertiary' />
              </Button>
            </div>
            <KnowledgeBaseInfo
              name={formData.name}
              description={formData.description ?? ''}
              onChange={data => handleFormChange({
                ...formData,
                ...data,
              })}
            />
            <Divider />
            <ExternalApiSelection
              external_knowledge_api_id={formData.external_knowledge_api_id}
              external_knowledge_id={formData.external_knowledge_id}
              onChange={data => handleFormChange({
                ...formData,
                ...data,
              })}
            />
            <RetrievalSettings
              topK={formData.external_retrieval_model.top_k}
              scoreThreshold={formData.external_retrieval_model.score_threshold}
              scoreThresholdEnabled={formData.external_retrieval_model.score_threshold_enabled}
              onChange={data => handleFormChange({
                ...formData,
                external_retrieval_model: {
                  ...formData.external_retrieval_model,
                  ...data,
                },
              })}
            />
            <div className='flex py-2 justify-end items-center gap-2 self-stretch'>
              <Button variant='secondary' onClick={navBackHandle}>
                <div className='text-components-button-secondary-text system-sm-medium'>{t('dataset.externalKnowledgeForm.cancel')}</div>
              </Button>
              <Button
                variant='primary'
                onClick={() => {
                  onConnect(formData)
                }}
                disabled={!isFormValid}
                loading={loading}
              >
                <div className='text-components-button-primary-text system-sm-medium'>{t('dataset.externalKnowledgeForm.connect')}</div>
                <RiArrowRightLine className='w-4 h-4 text-components-button-primary-text' />
              </Button>
            </div>
          </div>
        </div>
        <InfoPanel />
      </div>
    </div>
  )
}

export default ExternalKnowledgeBaseCreate
