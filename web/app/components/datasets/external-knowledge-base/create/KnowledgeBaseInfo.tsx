import { Input } from '@langgenius/dify-ui/input'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

type KnowledgeBaseInfoProps = {
  name: string
  description?: string
  onChange: (data: { name?: string; description?: string }) => void
}

const KnowledgeBaseInfo: React.FC<KnowledgeBaseInfoProps> = ({ name, description, onChange }) => {
  const { t } = useTranslation()
  const nameInputId = React.useId()
  const descriptionInputId = React.useId()

  return (
    <div className="flex flex-col gap-4 self-stretch">
      <div className="flex flex-col gap-4 self-stretch">
        <div className="flex flex-col gap-1 self-stretch">
          <div className="flex flex-col justify-center self-stretch">
            <label htmlFor={nameInputId} className="system-sm-semibold text-text-secondary">
              {t(($) => $.externalKnowledgeName, { ns: 'dataset' })}
            </label>
          </div>
          <Input
            id={nameInputId}
            value={name}
            onValueChange={(nextValue) => onChange({ name: nextValue })}
            placeholder={t(($) => $.externalKnowledgeNamePlaceholder, { ns: 'dataset' }) ?? ''}
          />
        </div>
        <div className="flex flex-col gap-1 self-stretch">
          <div className="flex flex-col justify-center self-stretch">
            <label htmlFor={descriptionInputId} className="system-sm-semibold text-text-secondary">
              {t(($) => $.externalKnowledgeDescription, { ns: 'dataset' })}
            </label>
          </div>
          <div className="flex flex-col gap-1 self-stretch">
            <textarea
              id={descriptionInputId}
              value={description}
              onChange={(e) => onChange({ description: e.target.value })}
              placeholder={
                t(($) => $.externalKnowledgeDescriptionPlaceholder, { ns: 'dataset' }) ?? ''
              }
              className={`flex h-20 items-start self-stretch rounded-lg bg-components-input-bg-normal p-3 py-2 ${description ? 'text-components-input-text-filled' : 'text-components-input-text-placeholder'} system-sm-regular`}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export default KnowledgeBaseInfo
