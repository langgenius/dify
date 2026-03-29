'use client'

import { RiPlayLargeLine } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

type RunModeProps = {
  text?: string
}

const RunMode = ({
  text,
}: RunModeProps) => {
  const { t } = useTranslation('snippet')

  return (
    <button
      type="button"
      className="flex h-7 items-center gap-1 rounded-md px-1.5 text-[13px] font-medium text-text-accent hover:bg-state-accent-hover"
    >
      <RiPlayLargeLine className="h-4 w-4" />
      <span>{text ?? t('testRunButton')}</span>
      <span className="rounded-md bg-state-accent-active px-1.5 py-0.5 text-[10px] font-semibold leading-3 text-text-accent">R</span>
    </button>
  )
}

export default React.memo(RunMode)
