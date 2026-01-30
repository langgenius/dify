'use client'

import { useDebounceFn } from 'ahooks'
import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import SearchInput from '@/app/components/base/search-input'

type TemplateSearchProps = {
  onChange: (value: string) => void
}

const TemplateSearch = ({
  onChange,
}: TemplateSearchProps) => {
  const { t } = useTranslation('workflow')
  const [localValue, setLocalValue] = useState('')
  const { run: debouncedOnChange } = useDebounceFn(onChange, { wait: 300 })

  const handleChange = useCallback((v: string) => {
    setLocalValue(v)
    debouncedOnChange(v)
  }, [debouncedOnChange])

  return (
    <SearchInput
      className="!h-7"
      placeholder={t('skill.startTab.searchPlaceholder')}
      value={localValue}
      onChange={handleChange}
    />
  )
}

export default memo(TemplateSearch)
