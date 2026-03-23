'use client'

import { useTranslation } from 'react-i18next'

const SnippetCreateCard = () => {
  const { t } = useTranslation('snippet')

  return (
    <div className="relative col-span-1 inline-flex h-[160px] flex-col justify-between rounded-xl border-[0.5px] border-components-card-border bg-components-card-bg transition-opacity">
      <div className="grow rounded-t-xl p-2">
        <div className="px-6 pb-1 pt-2 text-xs font-medium leading-[18px] text-text-tertiary">{t('create')}</div>
        <div className="mb-1 flex w-full items-center rounded-lg px-6 py-[7px] text-[13px] font-medium leading-[18px] text-text-tertiary">
          <span aria-hidden className="i-ri-sticky-note-add-line mr-2 h-4 w-4 shrink-0" />
          {t('newApp.startFromBlank', { ns: 'app' })}
        </div>
        <div className="flex w-full items-center rounded-lg px-6 py-[7px] text-[13px] font-medium leading-[18px] text-text-tertiary">
          <span aria-hidden className="i-ri-file-upload-line mr-2 h-4 w-4 shrink-0" />
          {t('importDSL', { ns: 'app' })}
        </div>
      </div>
    </div>
  )
}

export default SnippetCreateCard
