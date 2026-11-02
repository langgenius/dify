import type { Ref } from 'react'
import type { useCreationModels } from './use-creation-models'
import { Button } from '@langgenius/dify-ui/button'
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@langgenius/dify-ui/collapsible'
import { useEffect, useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ModelSelector } from '@/app/components/header/account-setting/model-provider-page/model-selector'

type CreationModels = ReturnType<typeof useCreationModels>

function CreationModelField({
  field,
  label,
  requiredMessage,
  disabled,
  onChange,
  triggerRef,
}: {
  field: CreationModels['fields']['reasoning']
  label: string
  requiredMessage: string
  disabled: boolean
  onChange: () => void
  triggerRef?: Ref<HTMLButtonElement>
}) {
  const { t } = useTranslation(['knowledgeCreate', 'common', 'modelProvider'])
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
              ? t(($) => $.modelPermissionDenied)
              : t(($) => $['modelProvider.selector.incompatible'], { ns: 'modelProvider' })
  const error =
    field.issue === 'missing'
      ? requiredMessage
      : field.issue === 'load-error'
        ? t(($) => $.modelsLoadFailed)
        : field.issue
          ? t(($) => $.modelUnavailable, { reason })
          : undefined

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div id={labelId} className="system-sm-medium text-text-secondary">
        {label}
        <span aria-hidden className="ms-0.5 text-text-destructive">
          *
        </span>
      </div>
      <ModelSelector
        triggerRef={triggerRef}
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
        <p id={errorId} className="system-xs-regular text-text-destructive">
          {error}
        </p>
      )}
      {field.issue === 'load-error' && (
        <Button
          type="button"
          size="small"
          className="self-start"
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

export function CreateModelSettings({
  models,
  open,
  onOpenChange,
  disabled,
  onChange,
  validationAttempt,
}: {
  models: CreationModels
  open: boolean
  onOpenChange: (open: boolean) => void
  disabled: boolean
  onChange: () => void
  validationAttempt: number
}) {
  const { t } = useTranslation(['knowledgeCreate', 'knowledgeSettings', 'modelProvider', 'common'])
  const descriptionId = useId()
  const invalidFieldRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (validationAttempt > 0) invalidFieldRef.current?.focus()
  }, [validationAttempt])
  const labels = {
    reasoning: t(($) => $['settings.systemReasoningModelLabel'], { ns: 'knowledgeSettings' }),
    embedding: t(($) => $['settings.embeddingModelLabel'], { ns: 'knowledgeSettings' }),
    rerank: t(($) => $['modelProvider.rerankModel.key'], { ns: 'modelProvider' }),
  }
  const requiredMessages = {
    reasoning: t(($) => $['settings.systemReasoningModelRequired'], { ns: 'knowledgeSettings' }),
    embedding: t(($) => $['settings.embeddingModelRequired'], { ns: 'knowledgeSettings' }),
    rerank: t(($) => $['settings.rerankModelRequired'], { ns: 'knowledgeSettings' }),
  }
  const fields = ['reasoning', 'embedding', 'rerank'] as const
  const firstInvalidField = fields.find((key) => models.fields[key].issue)

  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      className="border-t border-divider-subtle pt-4"
    >
      <CollapsibleTrigger
        type="button"
        aria-describedby={descriptionId}
        className="group flex items-center gap-2 rounded-lg py-2 text-start system-sm-semibold text-text-primary"
      >
        <span aria-hidden className="i-ri-settings-3-line size-4 text-text-tertiary" />
        <span className="flex-1">{t(($) => $.modelSettings)}</span>
        <span
          aria-hidden
          className="i-ri-arrow-down-s-line size-4 text-text-tertiary transition-transform group-data-panel-open:rotate-180"
        />
      </CollapsibleTrigger>
      <p id={descriptionId} className="body-xs-regular text-text-tertiary">
        {t(($) => $.modelSettingsDescription)}
      </p>
      {models.pending && (
        <p role="status" className="mt-2 system-xs-regular text-text-tertiary">
          {t(($) => $.loading, { ns: 'common' })}
        </p>
      )}
      {models.invalid && (
        <div role="status" className="mt-2 system-xs-regular text-text-destructive">
          <p>{t(($) => $.modelsNeedAttention)}</p>
          {!open && (
            <p>
              {fields
                .filter((key) => models.fields[key].issue)
                .map((key) => labels[key])
                .join(' · ')}
            </p>
          )}
        </div>
      )}
      <CollapsiblePanel>
        <div className="flex flex-col gap-4 pt-4 pb-1">
          {fields.map((key) => (
            <CreationModelField
              key={key}
              field={models.fields[key]}
              label={labels[key]}
              requiredMessage={requiredMessages[key]}
              disabled={disabled}
              onChange={onChange}
              triggerRef={key === firstInvalidField ? invalidFieldRef : undefined}
            />
          ))}
        </div>
      </CollapsiblePanel>
    </Collapsible>
  )
}
