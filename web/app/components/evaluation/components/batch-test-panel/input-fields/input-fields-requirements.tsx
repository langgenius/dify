import type { InputField } from './input-fields-utils'
import { useTranslation } from 'react-i18next'

type InputFieldsRequirementsProps = {
  inputFields: InputField[]
  isLoading: boolean
}

const InputFieldsRequirements = ({
  inputFields,
  isLoading,
}: InputFieldsRequirementsProps) => {
  const { t } = useTranslation('evaluation')

  return (
    <div>
      <div className="system-md-semibold text-text-primary">{t('batch.requirementsTitle')}</div>
      <div className="mt-1 system-xs-regular text-text-tertiary">{t('batch.requirementsDescription')}</div>
      <div className="mt-3 rounded-xl bg-background-section p-3">
        {isLoading && (
          <div className="px-1 py-0.5 system-xs-regular text-text-tertiary">
            {t('batch.loadingInputFields')}
          </div>
        )}
        {!isLoading && inputFields.length === 0 && (
          <div className="px-1 py-0.5 system-xs-regular text-text-tertiary">
            {t('batch.noTemplateColumns')}
          </div>
        )}
        {!isLoading && inputFields.map(field => (
          <div key={field.name} className="flex items-center py-1">
            <div className="rounded px-1 py-0.5 system-xs-medium text-text-tertiary">
              {field.name}
            </div>
            <div className="text-[10px] leading-3 text-text-quaternary">
              {field.type}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default InputFieldsRequirements
