import type { EvaluationResourceProps } from '../../../types'
import type { InputField } from './input-fields-utils'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { useEvaluationResource } from '../../../store'

type InputFieldsRequirementsProps = EvaluationResourceProps & {
  inputFields: InputField[]
  isLoading: boolean
}

const RETRIEVAL_NODE_TYPES = new Set([
  'knowledge-retrieval',
  'knowledge_retrieval',
  'knowledge-retrieval-v2',
])

const InputFieldRequirementRow = ({
  field,
  description,
}: {
  field: InputField
  description: string
}) => {
  const labelId = useId()

  return (
    <div className="flex min-h-7 items-center justify-between gap-2">
      <div className="flex min-w-0 items-center">
        <div
          id={labelId}
          className="min-w-0 rounded px-1 py-0.5 system-xs-medium break-words text-text-tertiary"
        >
          {field.name}
        </div>
        <div className="shrink-0 text-[10px] leading-3 text-text-quaternary">{field.type}</div>
      </div>
      <Infotip>
        <InfotipTrigger aria-labelledby={labelId} />
        <InfotipContent aria-labelledby={labelId} className="max-w-64">
          {description}
        </InfotipContent>
      </Infotip>
    </div>
  )
}

const InputFieldsRequirements = ({
  resourceType,
  resourceId,
  inputFields,
  isLoading,
}: InputFieldsRequirementsProps) => {
  const { t } = useTranslation(['evaluation'])
  const metrics = useEvaluationResource(resourceType, resourceId).metrics
  const retrievalNodeTitles = new Set(
    metrics
      .flatMap((metric) => metric.nodeInfoList ?? [])
      .filter((node) => RETRIEVAL_NODE_TYPES.has(node.type))
      .map((node) => node.title),
  )

  const getFieldDescription = (field: InputField) => {
    if (field.name === 'index') return t(($) => $['batch.fieldHelp.index'])

    const separatorIndex = field.name.lastIndexOf(':')
    const nodeTitle = separatorIndex < 0 ? '' : field.name.slice(0, separatorIndex).trim()
    const fieldName = separatorIndex < 0 ? field.name : field.name.slice(separatorIndex + 1).trim()

    if (fieldName === 'expected_output') {
      return resourceType === 'datasets' || retrievalNodeTitles.has(nodeTitle)
        ? t(($) => $['batch.fieldHelp.retrievalExpectedOutput'])
        : t(($) => $['batch.fieldHelp.expectedOutput'])
    }

    if (fieldName === 'success_criteria') return t(($) => $['batch.fieldHelp.successCriteria'])

    if (fieldName === 'expected_tool_calls') return t(($) => $['batch.fieldHelp.expectedToolCalls'])

    return t(($) => $['batch.fieldHelp.input'])
  }

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
            <InputFieldRequirementRow
              key={field.name}
              field={field}
              description={getFieldDescription(field)}
            />
          ))}
      </div>
    </div>
  )
}

export default InputFieldsRequirements
