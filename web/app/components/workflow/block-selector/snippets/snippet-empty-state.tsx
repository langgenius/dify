import type { FC } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { useTranslation } from 'react-i18next'

type SnippetEmptyStateProps = {
  onCreate: () => void
}

const SnippetEmptyState: FC<SnippetEmptyStateProps> = ({
  onCreate,
}) => {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-[480px] flex-col items-center justify-center gap-2 px-4">
      <span className="i-custom-vender-line-others-search-menu h-8 w-8 text-text-tertiary" />
      <div className="system-sm-regular text-text-secondary">
        {t('tabs.noSnippetsFound', { ns: 'workflow' })}
      </div>
      <Button
        variant="secondary-accent"
        size="small"
        onClick={onCreate}
      >
        {t('tabs.createSnippet', { ns: 'workflow' })}
      </Button>
    </div>
  )
}

export default SnippetEmptyState
