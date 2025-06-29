'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '@/app/components/base/modal'
import { fetchPromptTemplates } from '@/service/prompt-template'
import type { PromptTemplate } from '@/models/prompt-template'
import { SearchMd } from '@/app/components/base/icons/src/vender/solid/general'
import cn from 'classnames'

type IPromptTemplateSelectModalProps = {
  isShow: boolean
  onClose: () => void
  onSelect: (template: PromptTemplate) => void
}

const PromptTemplateSelectModal: FC<IPromptTemplateSelectModalProps> = ({
  isShow,
  onClose,
  onSelect,
}) => {
  const { t } = useTranslation()
  const [searchText, setSearchText] = useState('')
  const [templates, setTemplates] = useState<PromptTemplate[]>([])
  const [loading, setLoading] = useState(true)

  const fetchTemplates = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchPromptTemplates()
      setTemplates(res.data)
    }
    catch (e) {
      console.error(e)
    }
    finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isShow)
      fetchTemplates()
  }, [isShow, fetchTemplates])

  const filteredTemplates = templates.filter(template =>
    template.name.toLowerCase().includes(searchText.toLowerCase()),
  )

  if (!isShow)
    return null

  return (
    <Modal isShow={isShow} onClose={onClose} title={t('common.promptTemplate.title')} className='w-[800px]'>
      <div className='p-6'>
        <div className="relative">
          <SearchMd className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 focus:outline-none focus:ring-2 focus:ring-primary-500"
            placeholder={t('common.promptTemplate.searchPlaceholder') || ''}
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
          />
        </div>
        <div className='mt-4 h-[400px] overflow-y-auto'>
          {loading && <div className='py-4 text-center'>{t('common.loading')}</div>}
          {!loading && filteredTemplates.length === 0 && (
            <div className='py-4 text-center text-gray-500'>{t('common.promptTemplate.noTemplates')}</div>
          )}
          {!loading && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {filteredTemplates.map(template => (
                <div
                  key={template.id}
                  className={cn(
                    'cursor-pointer rounded-lg border p-4 hover:bg-gray-50',
                  )}
                  onClick={() => {
                    onSelect(template)
                  }}
                >
                  <div className="font-semibold text-gray-800">{template.name}</div>
                  <p className="mt-1 truncate text-sm text-gray-500" title={template.description || ''}>
                    {template.description || t('common.promptTemplate.noDescription')}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

export default React.memo(PromptTemplateSelectModal)
