'use client'

import { RiSearchLine } from '@remixicon/react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

type TemplateSearchProps = {
  value: string
  onChange: (value: string) => void
}

const TemplateSearch = ({
  value,
  onChange,
}: TemplateSearchProps) => {
  const { t } = useTranslation('workflow')

  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-md bg-components-input-bg-normal p-2">
      <RiSearchLine className="size-4 shrink-0 text-text-placeholder" aria-hidden="true" />
      <input
        type="text"
        name="template-search"
        aria-label={t('skill.startTab.searchPlaceholder')}
        className="system-sm-regular min-w-0 flex-1 bg-transparent px-1 text-text-secondary placeholder:text-components-input-text-placeholder focus:outline-none"
        placeholder={t('skill.startTab.searchPlaceholder')}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  )
}

export default memo(TemplateSearch)
