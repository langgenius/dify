import * as React from 'react'
import { useTranslation } from 'react-i18next'
import FilterEmptyState from '@/app/components/base/filter-empty-state'

type EmptyProps = {
  message?: string
}

const Empty = ({ message }: EmptyProps) => {
  const { t } = useTranslation()

  return <FilterEmptyState title={message ?? t('filterEmpty.noApps', { ns: 'app' })} />
}

export default React.memo(Empty)
