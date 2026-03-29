'use client'

import { memo } from 'react'
import { useTranslation } from 'react-i18next'

type PublisherProps = {
  onClick: () => void
}

const Publisher = ({
  onClick,
}: PublisherProps) => {
  const { t } = useTranslation('snippet')

  return (
    <button
      type="button"
      className="flex items-center gap-1 rounded-lg bg-components-button-primary-bg px-3 py-2 text-white shadow-[0px_2px_2px_-1px_rgba(0,0,0,0.12),0px_1px_1px_-1px_rgba(0,0,0,0.12),0px_0px_0px_0.5px_rgba(9,9,11,0.05)]"
      onClick={onClick}
    >
      <span className="text-[13px] font-medium leading-4">{t('publishButton')}</span>
      <span aria-hidden className="i-ri-arrow-down-s-line h-4 w-4" />
    </button>
  )
}

export default memo(Publisher)
