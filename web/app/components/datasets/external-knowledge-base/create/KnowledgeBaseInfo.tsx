import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'

type KnowledgeBaseInfoProps = {
  name: string
  description?: string
  onChange: (data: { name?: string, description?: string }) => void
}

const KnowledgeBaseInfo: React.FC<KnowledgeBaseInfoProps> = ({ name, description, onChange }) => {
  const { t } = useTranslation()

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ name: e.target.value })
  }

  const handleDescriptionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange({ description: e.target.value })
  }

  return (
    <form className="flex flex-col gap-4 self-stretch">
      <div className="flex flex-col gap-4 self-stretch">
        <div className="flex flex-col gap-1 self-stretch">
          <div className="flex flex-col justify-center self-stretch">
            <label className="system-sm-semibold text-text-secondary">{t('externalKnowledgeName', { ns: 'dataset' })}</label>
          </div>
          <Input
            value={name}
            onChange={handleNameChange}
            placeholder={t('externalKnowledgeNamePlaceholder', { ns: 'dataset' }) ?? ''}
          />
        </div>
        <div className="flex flex-col gap-1 self-stretch">
          <div className="flex flex-col justify-center self-stretch">
            <label className="system-sm-semibold text-text-secondary">{t('externalKnowledgeDescription', { ns: 'dataset' })}</label>
          </div>
          <div className="flex flex-col gap-1 self-stretch">
            <textarea
              value={description}
              onChange={e => handleDescriptionChange(e)}
              placeholder={t('externalKnowledgeDescriptionPlaceholder', { ns: 'dataset' }) ?? ''}
              className={`flex h-20 items-start self-stretch rounded-lg bg-components-input-bg-normal p-3 py-2 ${description ? 'text-components-input-text-filled' : 'text-components-input-text-placeholder'} system-sm-regular`}
            />
          </div>
        </div>
      </div>
    </form>
  )
}

export default KnowledgeBaseInfo
