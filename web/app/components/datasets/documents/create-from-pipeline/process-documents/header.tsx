import { RiSearchEyeLine } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'

type HeaderProps = {
  onReset: () => void
  resetDisabled: boolean
  previewDisabled: boolean
  onPreview?: () => void
}

const Header = ({
  onReset,
  resetDisabled,
  previewDisabled,
  onPreview,
}: HeaderProps) => {
  const { t } = useTranslation()

  return (
    <div className="flex items-center gap-x-1 px-4 py-2">
      <div className="system-sm-semibold-uppercase grow text-text-secondary">
        {t('datasetPipeline.addDocuments.stepTwo.chunkSettings')}
      </div>
      <Button variant="ghost" disabled={resetDisabled} onClick={onReset}>
        {t('common.operation.reset')}
      </Button>
      <Button
        variant="secondary-accent"
        onClick={onPreview}
        className="gap-x-0.5"
        disabled={previewDisabled}
      >
        <RiSearchEyeLine className="size-4" />
        <span className="px-0.5">{t('datasetPipeline.addDocuments.stepTwo.previewChunks')}</span>
      </Button>
    </div>
  )
}

export default React.memo(Header)
