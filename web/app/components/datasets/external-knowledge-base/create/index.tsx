'use client'

import type { CreateKnowledgeBaseReq } from './declarations'
import { RiArrowLeftLine, RiArrowRightLine } from '@remixicon/react'
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Divider from '@/app/components/base/divider'
import { useDocLink } from '@/context/i18n'
import ExternalApiSelection from './ExternalApiSelection'
import InfoPanel from './InfoPanel'
import KnowledgeBaseInfo from './KnowledgeBaseInfo'
import RetrievalSettings from './RetrievalSettings'

type ExternalKnowledgeBaseCreateProps = {
  onConnect: (formValue: CreateKnowledgeBaseReq) => void
  loading: boolean
}

const ExternalKnowledgeBaseCreate: React.FC<ExternalKnowledgeBaseCreateProps> = ({ onConnect, loading }) => {
  const { t } = useTranslation()
  const docLink = useDocLink()
  const router = useRouter()
  const [formData, setFormData] = useState<CreateKnowledgeBaseReq>({
    name: '',
    description: '',
    external_knowledge_api_id: '',
    external_knowledge_id: '',
    external_retrieval_model: {
      top_k: 4,
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
    <div className="flex grow flex-col self-stretch rounded-t-2xl border-t border-effects-highlight bg-components-panel-bg">
      <div className="flex grow justify-center self-stretch">
        <div className="flex w-full max-w-[960px] flex-col items-center px-14 py-0">
          <div className="flex w-full max-w-[640px] grow flex-col items-center gap-4 pb-8 pt-6">
            <div className="relative flex flex-col items-center gap-[2px] self-stretch py-2">
              <div className="system-xl-semibold grow self-stretch text-text-primary">{t('connectDataset', { ns: 'dataset' })}</div>
              <p className="system-sm-regular text-text-tertiary">
                <span>{t('connectHelper.helper1', { ns: 'dataset' })}</span>
                <span className="system-sm-medium text-text-secondary">{t('connectHelper.helper2', { ns: 'dataset' })}</span>
                <span>{t('connectHelper.helper3', { ns: 'dataset' })}</span>
                <a className="system-sm-regular self-stretch text-text-accent" href={docLink('/use-dify/knowledge/connect-external-knowledge-base')} target="_blank" rel="noopener noreferrer">
                  {t('connectHelper.helper4', { ns: 'dataset' })}
                </a>
                <span>
                  {t('connectHelper.helper5', { ns: 'dataset' })}
                  {' '}
                </span>
              </p>
              <Button
                className="absolute left-[-44px] top-1 flex h-8 w-8 items-center justify-center rounded-full p-2"
                variant="tertiary"
                onClick={navBackHandle}
              >
                <RiArrowLeftLine className="h-4 w-4 text-text-tertiary" />
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
            <div className="flex items-center justify-end gap-2 self-stretch py-2">
              <Button variant="secondary" onClick={navBackHandle}>
                <div className="system-sm-medium text-components-button-secondary-text">{t('externalKnowledgeForm.cancel', { ns: 'dataset' })}</div>
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  onConnect(formData)
                }}
                disabled={!isFormValid}
                loading={loading}
              >
                <div className="system-sm-medium text-components-button-primary-text">{t('externalKnowledgeForm.connect', { ns: 'dataset' })}</div>
                <RiArrowRightLine className="h-4 w-4 text-components-button-primary-text" />
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
