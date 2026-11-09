'use client'
import type { ReactNode } from 'react'
import type { Tool } from '@/app/components/tools/types'
import type { FormInputSchema } from '@/app/components/workflow/nodes/_base/components/form-input-item.helpers'
import type { ResourceVarInputs } from '@/app/components/workflow/nodes/_base/types'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import { useId } from 'react'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { SchemaDialog } from '@/app/components/plugins/plugin-detail-panel/tool-selector/components/schema-dialog'
import FormInputItem from '@/app/components/workflow/nodes/_base/components/form-input-item'

const URL_REGEX = /(https?:\/\/\S+)/g

const renderDescriptionWithLinks = (description: string): ReactNode => {
  const matches = [...description.matchAll(URL_REGEX)]

  if (!matches.length) return description

  const parts: ReactNode[] = []
  let currentIndex = 0

  matches.forEach((match) => {
    const [url] = match
    const start = match.index ?? 0

    if (start > currentIndex) parts.push(description.slice(currentIndex, start))

    parts.push(
      <a
        key={`${url}-${start}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-text-accent hover:underline"
      >
        {url}
      </a>,
    )

    currentIndex = start + url.length
  })

  if (currentIndex < description.length) parts.push(description.slice(currentIndex))

  return parts
}

type Props = Readonly<{
  staticSchema?: boolean
  readOnly: boolean
  nodeId: string
  schema: FormInputSchema
  value: ResourceVarInputs
  onChange: (value: ResourceVarInputs) => void
  currentTool?: Tool
  currentProvider?: ToolWithProvider
  showManageInputField?: boolean
  onManageInputField?: () => void
  extraParams?: Record<string, unknown>
  providerType?: 'tool' | 'trigger'
}>

export function ToolFormItem({
  readOnly,
  staticSchema = false,
  nodeId,
  schema,
  value,
  onChange,
  currentTool,
  currentProvider,
  showManageInputField,
  onManageInputField,
  extraParams,
  providerType = 'tool',
}: Props) {
  const language = useLanguage()
  const labelId = useId()
  const { name, label, type, required, tooltip, input_schema } = schema
  const showSchemaButton = type === FormTypeEnum.object || type === FormTypeEnum.array
  const showDescription =
    type === FormTypeEnum.textInput ||
    type === FormTypeEnum.textNumber ||
    type === FormTypeEnum.secretInput ||
    type === FormTypeEnum.date ||
    type === FormTypeEnum.dateRange
  return (
    <div className="space-y-0.5 py-1">
      <div>
        <div className="flex min-h-6 min-w-0 items-center">
          <div
            id={labelId}
            className="min-w-0 system-sm-medium wrap-break-word text-text-secondary"
          >
            {label[language] || label.en_US}
          </div>
          {required && (
            <div className="ml-1 system-xs-regular text-text-destructive-secondary">*</div>
          )}
          {!showDescription && tooltip && (
            <Infotip>
              <InfotipTrigger aria-labelledby={labelId} className="ml-1" />
              <InfotipContent aria-labelledby={labelId} className="w-50">
                {tooltip[language] || tooltip.en_US}
              </InfotipContent>
            </Infotip>
          )}
          {showSchemaButton && (
            <>
              <div className="mr-0.5 ml-1 system-xs-regular text-text-quaternary">·</div>
              <SchemaDialog schema={input_schema} rootName={name} />
            </>
          )}
        </div>
        {showDescription && tooltip && (
          <div className="pb-0.5 body-xs-regular wrap-break-word text-text-tertiary">
            {renderDescriptionWithLinks(tooltip[language] || tooltip.en_US)}
          </div>
        )}
      </div>
      <FormInputItem
        labelId={labelId}
        readOnly={readOnly}
        staticSchema={staticSchema}
        nodeId={nodeId}
        schema={schema}
        value={value}
        onChange={onChange}
        currentTool={currentTool}
        currentProvider={currentProvider}
        showManageInputField={showManageInputField}
        onManageInputField={onManageInputField}
        extraParams={extraParams}
        providerType={providerType}
      />
    </div>
  )
}
