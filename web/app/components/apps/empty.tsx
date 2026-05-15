import * as React from 'react'
import { useTranslation } from 'react-i18next'
import FilterEmptyState from '@/app/components/base/filter-empty-state'

const Empty = () => {
  const { t } = useTranslation()

  return <FilterEmptyState title={t('filterEmpty.noApps', { ns: 'app' })} />
}

export default React.memo(Empty)
