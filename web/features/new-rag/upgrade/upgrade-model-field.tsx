import type { UpgradeModelFieldState } from './use-upgrade-models'
import { Button } from '@langgenius/dify-ui/button'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { ModelSelector } from '@/app/components/header/account-setting/model-provider-page/model-selector'

export function UpgradeModelField({
  field,
  label,
  requiredMessage,
  disabled,
  onChange,
}: {
  field: UpgradeModelFieldState
  label: string
  requiredMessage: string
  disabled: boolean
  onChange: () => void
}) {
  const { t } = useTranslation(['knowledgeUpgrade', 'common', 'modelProvider'])
  const labelId = useId()
  const errorId = useId()
  const reason =
    field.issue === 'disabled'
      ? t(($) => $['modelProvider.selector.disabled'], { ns: 'modelProvider' })
      : field.issue === 'quota-exceeded'
        ? t(($) => $['modelProvider.selector.creditsExhausted'], { ns: 'modelProvider' })
        : field.issue === 'credential-removed'
          ? t(($) => $['modelProvider.selector.apiKeyUnavailable'], { ns: 'modelProvider' })
          : field.issue === 'no-configure'
            ? t(($) => $['modelProvider.selector.configureRequired'], { ns: 'modelProvider' })
            : field.issue === 'no-permission'
              ? t(($) => $['upgrade.modelPermissionDenied'], { ns: 'knowledgeUpgrade' })
              : t(($) => $['modelProvider.selector.incompatible'], { ns: 'modelProvider' })
  const error =
    field.issue === 'missing'
      ? requiredMessage
      : field.issue === 'load-error'
        ? t(($) => $['upgrade.modelsLoadFailed'], { ns: 'knowledgeUpgrade' })
        : field.issue
          ? t(($) => $['upgrade.modelUnavailable'], { ns: 'knowledgeUpgrade', reason })
          : undefined

  return (
    <div className="grid min-w-0 grid-cols-[8.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1">
      <div id={labelId} className="system-sm-medium text-text-secondary">
        {label}
        <span aria-hidden className="ms-0.5 text-text-destructive">
          *
        </span>
      </div>
      <ModelSelector
        ariaLabelledBy={labelId}
        ariaDescribedBy={error ? errorId : undefined}
        ariaInvalid={Boolean(error)}
        ariaRequired
        value={field.value}
        models={field.models}
        loading={field.pending}
        disabled={disabled}
        className="w-full"
        onValueChange={(value) => {
          field.setSelection(value)
          onChange()
        }}
      />
      {error && (
        <p id={errorId} className="col-start-2 system-xs-regular text-text-destructive">
          {error}
        </p>
      )}
      {field.issue === 'load-error' && (
        <Button
          type="button"
          size="small"
          className="col-start-2 self-start justify-self-start"
          loading={field.refreshing}
          disabled={disabled}
          onClick={() => void field.retry()}
        >
          {t(($) => $['operation.retry'], { ns: 'common' })}
        </Button>
      )}
    </div>
  )
}
