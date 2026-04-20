'use client'

import { memo } from 'react'
import { useTranslation } from 'react-i18next'

type InputFieldButtonProps = {
  count: number
  onClick: () => void
}

const InputFieldButton = ({
  count,
  onClick,
}: InputFieldButtonProps) => {
  const { t } = useTranslation('snippet')

  return (
    <button
      type="button"
      className="flex h-8 items-center gap-1 rounded-lg border border-components-button-secondary-border bg-components-button-secondary-bg px-3 text-text-secondary shadow-xs backdrop-blur"
      onClick={onClick}
    >
      <span aria-hidden className="i-custom-vender-workflow-input-field h-4 w-4 shrink-0" />
      <span className="text-[13px] font-medium leading-4">{t('inputFieldButton')}</span>
      <span className="rounded-md border border-divider-deep px-1 py-0.5 text-[10px] font-medium leading-3 text-text-tertiary">
        {count}
      </span>
    </button>
  )
}

export default memo(InputFieldButton)
