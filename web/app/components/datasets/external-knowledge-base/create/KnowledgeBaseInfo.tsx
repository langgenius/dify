import React from 'react'
import { RiBookOpenLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'

type KnowledgeBaseInfoProps = {
  name: string
  description?: string
  onChange: (data: { name?: string; description?: string }) => void
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
    <form className='flex flex-col gap-4 self-stretch'>
      <div className='flex flex-col gap-4 self-stretch'>
        <div className='flex flex-col gap-1 self-stretch'>
          <div className='flex flex-col justify-center self-stretch'>
            <label className='text-text-secondary system-sm-semibold'>{t('dataset.externalKnowledgeName')}</label>
          </div>
          <Input
            value={name}
            onChange={handleNameChange}
            placeholder={t('dataset.externalKnowledgeNamePlaceholder') ?? ''}
          />
        </div>
        <div className='flex flex-col gap-1 self-stretch'>
          <div className='flex flex-col justify-center self-stretch'>
            <label className='text-text-secondary system-sm-semibold'>{t('dataset.externalKnowledgeDescription')}</label>
          </div>
          <div className='flex flex-col gap-1 self-stretch'>
            <textarea
              value={description}
              onChange={ e => handleDescriptionChange(e)}
              placeholder={t('dataset.externalKnowledgeDescriptionPlaceholder') ?? ''}
              className={`flex h-20 py-2 p-3 self-stretch items-start rounded-lg bg-components-input-bg-normal ${description ? 'text-components-input-text-filled' : 'text-components-input-text-placeholder'} system-sm-regular`}
            />
            <a
              className='flex py-0.5 gap-1 self-stretch'
              href='https://docs.dify.ai/features/datasets#how-to-write-a-good-dataset-description'
              target="_blank"
              rel="noopener noreferrer"
            >
              <div className='flex p-0.5 items-center gap-2'>
                <RiBookOpenLine className='w-3 h-3 text-text-tertiary' />
              </div>
              <div className='flex-grow text-text-tertiary body-xs-regular'>{t('dataset.learnHowToWriteGoodKnowledgeDescription')}</div>
            </a>
          </div>
        </div>
      </div>
    </form>
  )
}

export default KnowledgeBaseInfo
