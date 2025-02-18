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
    <div className='border-effects-highlight bg-components-panel-bg flex grow flex-col self-stretch rounded-t-2xl border-t'>
      <div className='flex grow justify-center self-stretch'>
        <div className='flex w-full max-w-[960px] flex-col items-center px-14 py-0'>
          <div className='flex w-full max-w-[640px] grow flex-col items-center gap-4 pb-8 pt-6'>
            <div className='relative flex flex-col items-center gap-[2px] self-stretch py-2'>
              <div className='text-text-primary system-xl-semibold grow self-stretch'>{t('dataset.connectDataset')}</div>
              <p className='text-text-tertiary system-sm-regular'>
                <span>{t('dataset.connectHelper.helper1')}</span>
                <span className='text-text-secondary system-sm-medium'>{t('dataset.connectHelper.helper2')}</span>
                <span>{t('dataset.connectHelper.helper3')}</span>
                <a className='text-text-accent system-sm-regular self-stretch' href='https://docs.dify.ai/guides/knowledge-base/connect-external-knowledge' target='_blank' rel="noopener noreferrer">
                  {t('dataset.connectHelper.helper4')}
                </a>
                <span>{t('dataset.connectHelper.helper5')} </span>
              </p>
              <Button
                className='absolute left-[-44px] top-1 flex h-8 w-8 items-center justify-center rounded-full p-2'
                variant='tertiary'
                onClick={navBackHandle}
              >
                <RiArrowLeftLine className='text-text-tertiary h-4 w-4' />
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
            <div className='flex items-center justify-end gap-2 self-stretch py-2'>
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
                <RiArrowRightLine className='text-components-button-primary-text h-4 w-4' />
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
