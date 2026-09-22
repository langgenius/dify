'use client'
import type { FC } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

const HitHistoryNoData: FC = () => {
  const { t } = useTranslation()
  return (
    <div className="mx-auto mt-20 w-120 space-y-2 rounded-2xl bg-background-section-burn p-5">
      <div className="inline-block rounded-lg border border-divider-subtle p-3">
        <span
          aria-hidden
          className="i-custom-vender-line-time-clock-fast-forward size-5 text-text-tertiary"
        />
      </div>
      <div className="system-sm-regular text-text-tertiary">
        {t(($) => $['viewModal.noHitHistory'], { ns: 'appAnnotation' })}
      </div>
    </div>
  )
}

export default React.memo(HitHistoryNoData)
