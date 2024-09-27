'use client'

import React, { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { RiAddLine } from '@remixicon/react'
import { useRouter } from 'next/navigation'
import ExternalApiSelect from './ExternalApiSelect'
import Input from '@/app/components/base/input'
import Button from '@/app/components/base/button'
import { useExternalKnowledgeApi } from '@/context/external-knowledge-api-context'

type ExternalApiSelectionProps = {
  external_knowledge_api_id: string
  external_knowledge_id: string
  onChange: (data: { external_knowledge_api_id?: string; external_knowledge_id?: string }) => void
}

const ExternalApiSelection: React.FC<ExternalApiSelectionProps> = ({ external_knowledge_api_id, external_knowledge_id, onChange }) => {
  const { t } = useTranslation()
  const router = useRouter()
  const { externalKnowledgeApiList } = useExternalKnowledgeApi()

  const apiItems = externalKnowledgeApiList.map(api => ({
    value: api.id,
    name: api.name,
    url: api.settings.endpoint,
  }))

  const handleAddNewAPI = () => {
    router.push('/datasets?openExternalApiPanel=true')
  }

  useEffect(() => {
    if (!external_knowledge_api_id && apiItems.length > 0)
      onChange({ external_knowledge_api_id: apiItems[0].value, external_knowledge_id })
  }, [])

  return (
    <form className='flex flex-col gap-4 self-stretch'>
      <div className='flex flex-col gap-1 self-stretch'>
        <div className='flex flex-col self-stretch'>
          <label className='text-text-secondary system-sm-semibold'>{t('dataset.externalAPIPanelTitle')}</label>
        </div>
        {apiItems.length > 0
          ? <ExternalApiSelect
            items={apiItems}
            defaultValue={apiItems[0].value}
            onSelect={e => onChange({ external_knowledge_api_id: e.value as string, external_knowledge_id })}
          />
          : <Button variant={'tertiary'} onClick={handleAddNewAPI} className='justify-start gap-0.5'>
            <RiAddLine className='w-4 h-4 text-text-tertiary' />
            <span className='text-text-tertiary system-sm-regular'>{t('dataset.noExternalKnowledge')}</span>
          </Button>
        }
      </div>
      <div className='flex flex-col gap-1 self-stretch'>
        <div className='flex flex-col self-stretch'>
          <label className='text-text-secondary system-sm-semibold'>{t('dataset.externalKnowledgeId')}</label>
        </div>
        <Input
          value={external_knowledge_id}
          onChange={e => onChange({ external_knowledge_id: e.target.value, external_knowledge_api_id })}
          placeholder={t('dataset.externalKnowledgeIdPlaceholder') ?? ''}
        />
      </div>
    </form>
  )
}

export default ExternalApiSelection
