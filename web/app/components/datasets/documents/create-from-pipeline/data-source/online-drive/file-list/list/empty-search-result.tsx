import { Button } from '@langgenius/dify-ui/button'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

type EmptySearchResultProps = {
  onResetKeywords: () => void
}

const EmptySearchResult = ({
  onResetKeywords,
}: EmptySearchResultProps & {
  className?: string
}) => {
  const { t } = useTranslation(['datasetPipeline'])

  return (
    <div className="flex size-full flex-col items-center justify-center gap-y-2 rounded-[10px] bg-background-section p-6">
      <span
        aria-hidden
        className="i-custom-vender-knowledge-search-menu size-8 text-text-tertiary"
      />
      <div className="system-sm-regular text-text-secondary">
        {t(($) => $['onlineDrive.emptySearchResult'], { ns: 'datasetPipeline' })}
      </div>
      <Button variant="secondary-accent" size="small" onClick={onResetKeywords}>
        <span>{t(($) => $['onlineDrive.resetKeywords'], { ns: 'datasetPipeline' })}</span>
      </Button>
    </div>
  )
}

export default React.memo(EmptySearchResult)
