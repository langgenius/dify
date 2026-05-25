import { useTranslation } from 'react-i18next'

const SnippetEmptyState = () => {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-120 flex-col items-center justify-center gap-2 px-4">
      <span className="i-custom-vender-line-others-search-menu h-8 w-8 text-text-tertiary" />
      <div className="system-sm-regular text-text-secondary">
        {t('tabs.noSnippetsFound', { ns: 'workflow' })}
      </div>
    </div>
  )
}

export default SnippetEmptyState
