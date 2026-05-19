import { Button } from '@langgenius/dify-ui/button'
import { useTranslation } from 'react-i18next'

type ModelSelectorEmptyStateProps = {
  onConfigure: () => void
}

function ModelSelectorEmptyState({
  onConfigure,
}: ModelSelectorEmptyStateProps) {
  const { t } = useTranslation()

  return (
    <div className="mx-2 flex flex-col gap-2 rounded-[10px] bg-linear-to-r from-state-base-hover to-background-gradient-mask-transparent p-4">
      <div className="flex h-10 w-10 items-center justify-center rounded-[10px] border-[0.5px] border-components-card-border bg-components-card-bg shadow-lg backdrop-blur-[5px]">
        <span className="i-ri-brain-2-line h-5 w-5 text-text-tertiary" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="system-sm-medium text-text-secondary">
          {t('modelProvider.selector.noProviderConfigured', { ns: 'common' })}
        </p>
        <p className="system-xs-regular text-text-tertiary">
          {t('modelProvider.selector.noProviderConfiguredDesc', { ns: 'common' })}
        </p>
      </div>
      <Button
        variant="primary"
        className="w-[108px]"
        onClick={onConfigure}
      >
        {t('modelProvider.selector.configure', { ns: 'common' })}
        <span className="i-ri-arrow-right-line h-4 w-4" />
      </Button>
    </div>
  )
}

export default ModelSelectorEmptyState
