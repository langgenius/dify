import { useTranslation } from 'react-i18next'
import Select from '@/app/components/base/select'
import Input from '@/app/components/base/input'
import { useExternalKnowledgeApi } from '@/context/external-knowledge-api-context'
type ExternalApiSelectionProps = {
  external_knowledge_api_id: string
  external_knowledge_id: string
  onChange: (data: { external_knowledge_api_id?: string; external_knowledge_id?: string }) => void
}

const ExternalApiSelection = ({ external_knowledge_api_id, external_knowledge_id, onChange }: ExternalApiSelectionProps) => {
  const { t } = useTranslation()
  const { externalKnowledgeApiList } = useExternalKnowledgeApi()

  const apiItems = externalKnowledgeApiList.map(api => ({
    value: api.id,
    name: api.name,
  }))

  return (
    <form className='flex flex-col gap-4 self-stretch'>
      <div className='flex flex-col gap-1 self-stretch'>
        <div className='flex flex-col self-stretch'>
          <label className='text-text-secondary system-sm-semibold'>{t('dataset.externalAPIPanelTitle')}</label>
        </div>
        <Select
          className='w-full'
          items={apiItems}
          defaultValue={apiItems.length > 0 ? apiItems[0].value : ''}
          onSelect={e => onChange({ external_knowledge_api_id: e.value as string, external_knowledge_id })}
        />
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
