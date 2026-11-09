import type { InputField } from './input-fields-utils'
import { useTranslation } from 'react-i18next'

type InputFieldsRequirementsProps = {
  inputFields: InputField[]
  isLoading: boolean
}

const InputFieldsRequirements = ({ inputFields, isLoading }: InputFieldsRequirementsProps) => {
  const { t } = useTranslation(['evaluation'])

  return (
    <div>
      <div className="system-md-semibold text-text-primary">
        {t(($) => $['batch.requirementsTitle'])}
      </div>
      <div className="mt-1 system-xs-regular text-text-tertiary">
        {t(($) => $['batch.requirementsDescription'])}
      </div>
      <div className="mt-3 rounded-xl bg-background-section p-3">
        {/* Placeholder rows keep the buttons below from jumping when the columns load. */}
        {isLoading && (
          <div role="status" aria-label={t(($) => $['batch.loadingInputFields'])}>
            {['field-skeleton-1', 'field-skeleton-2', 'field-skeleton-3'].map((key) => (
              <div key={key} className="flex h-7 items-center px-1">
                <div className="h-3 w-32 animate-pulse rounded bg-background-default-subtle" />
              </div>
            ))}
          </div>
        )}
        {!isLoading && inputFields.length === 0 && (
          <div className="px-1 py-0.5 system-xs-regular text-text-tertiary">
            {t(($) => $['batch.noTemplateColumns'])}
          </div>
        )}
        {!isLoading &&
          inputFields.map((field) => (
            <div key={field.name} className="flex min-h-7 items-center">
              <div className="rounded px-1 py-0.5 system-xs-medium text-text-tertiary">
                {field.name}
              </div>
              <div className="text-[10px] leading-3 text-text-quaternary">{field.type}</div>
            </div>
          ))}
      </div>
    </div>
  )
}

export default InputFieldsRequirements
