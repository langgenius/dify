import React, { useEffect, useState } from 'react'
import { RiBookOpenLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'

type KnowledgeBaseInfoProps = {
  name: string
  description: string
  onChange: (data: { name?: string; description?: string }) => void
}

const KnowledgeBaseInfo: React.FC<KnowledgeBaseInfoProps> = ({ name: initialName, description: initialDescription, onChange }) => {
  const { t } = useTranslation()
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription)

  useEffect(() => {
    const savedName = localStorage.getItem('knowledgeBaseName')
    const savedDescription = localStorage.getItem('knowledgeBaseDescription')

    if (savedName)
      setName(savedName)
    if (savedDescription)
      setDescription(savedDescription)

    onChange({ name: savedName || initialName, description: savedDescription || initialDescription })
  }, [])

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value
    setName(newName)
    localStorage.setItem('knowledgeBaseName', newName)
    onChange({ name: newName })
  }

  const handleDescriptionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newDescription = e.target.value
    setDescription(newDescription)
    localStorage.setItem('knowledgeBaseDescription', newDescription)
    onChange({ description: newDescription })
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
            <Input
              value={description}
              onChange={handleDescriptionChange}
              placeholder={t('dataset.externalKnowledgeDescriptionPlaceholder') ?? ''}
              className='flex h-20 p-2 self-stretch items-start'
            />
            <div className='flex py-0.5 gap-1 self-stretch'>
              <div className='flex p-0.5 items-center gap-2'>
                <RiBookOpenLine className='w-3 h-3 text-text-tertiary' />
              </div>
              <div className='flex-grow text-text-tertiary body-xs-regular'>{t('dataset.learnHowToWriteGoodKnowledgeDescription')}</div>
            </div>
          </div>
        </div>
      </div>
    </form>
  )
}

export const clearKnowledgeBaseInfo = () => {
  localStorage.removeItem('knowledgeBaseName')
  localStorage.removeItem('knowledgeBaseDescription')
}

export default KnowledgeBaseInfo
