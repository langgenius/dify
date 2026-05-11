'use client'
import type { FC, ReactNode } from 'react'
import type { ToolVarInputs } from '../../types'
import type { CredentialFormSchema } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { Tool } from '@/app/components/tools/types'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { Button } from '@langgenius/dify-ui/button'
import {
  RiBracesLine,
} from '@remixicon/react'
import { useBoolean } from 'ahooks'
import { Infotip } from '@/app/components/base/infotip'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { SchemaModal } from '@/app/components/plugins/plugin-detail-panel/tool-selector/components'
import FormInputItem from '@/app/components/workflow/nodes/_base/components/form-input-item'

const URL_REGEX = /(https?:\/\/\S+)/g

const renderDescriptionWithLinks = (description: string): ReactNode => {
  const matches = [...description.matchAll(URL_REGEX)]

  if (!matches.length)
    return description

  const parts: ReactNode[] = []
  let currentIndex = 0

  matches.forEach((match, index) => {
    const [url] = match
    const start = match.index ?? 0

    if (start > currentIndex)
      parts.push(description.slice(currentIndex, start))

    parts.push(
      <a
        key={`${url}-${index}`}
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

  if (currentIndex < description.length)
    parts.push(description.slice(currentIndex))

  return parts
}

type Props = {
  readOnly: boolean
  nodeId: string
  schema: CredentialFormSchema
  value: ToolVarInputs
  onChange: (value: ToolVarInputs) => void
  inPanel?: boolean
  currentTool?: Tool
  currentProvider?: ToolWithProvider
  showManageInputField?: boolean
  onManageInputField?: () => void
  extraParams?: Record<string, any>
  providerType?: 'tool' | 'trigger'
}

const ToolFormItem: FC<Props> = ({
  readOnly,
  nodeId,
  schema,
  value,
  onChange,
  inPanel,
  currentTool,
  currentProvider,
  showManageInputField,
  onManageInputField,
  extraParams,
  providerType = 'tool',
}) => {
  const language = useLanguage()
  const { name, label, type, required, tooltip, input_schema } = schema
  const showSchemaButton = type === FormTypeEnum.object || type === FormTypeEnum.array
  const showDescription = type === FormTypeEnum.textInput || type === FormTypeEnum.secretInput
  const [isShowSchema, {
    setTrue: showSchema,
    setFalse: hideSchema,
  }] = useBoolean(false)
  return (
    <div className="space-y-0.5 py-1">
      <div>
        <div className="flex h-6 items-center">
          <div className="system-sm-medium text-text-secondary">{label[language] || label.en_US}</div>
          {required && (
            <div className="ml-1 system-xs-regular text-text-destructive-secondary">*</div>
          )}
          {!showDescription && tooltip && (
            <Infotip
              aria-label={tooltip[language] || tooltip.en_US}
              className="ml-1"
              popupClassName="w-[200px]"
            >
              {tooltip[language] || tooltip.en_US}
            </Infotip>
          )}
          {showSchemaButton && (
            <>
              <div className="mr-0.5 ml-1 system-xs-regular text-text-quaternary">·</div>
              <Button
                variant="ghost"
                size="small"
                onClick={showSchema}
                className="px-1 system-xs-regular text-text-tertiary"
              >
                <RiBracesLine className="mr-1 size-3.5" />
                <span>JSON Schema</span>
              </Button>
            </>
          )}
        </div>
        {showDescription && tooltip && (
          <div className="pb-0.5 body-xs-regular break-words text-text-tertiary">
            {renderDescriptionWithLinks(tooltip[language] || tooltip.en_US)}
          </div>
        )}
      </div>
      <FormInputItem
        readOnly={readOnly}
        nodeId={nodeId}
        schema={schema}
        value={value}
        onChange={onChange}
        inPanel={inPanel}
        currentTool={currentTool}
        currentProvider={currentProvider}
        showManageInputField={showManageInputField}
        onManageInputField={onManageInputField}
        extraParams={extraParams}
        providerType={providerType}
      />

      {isShowSchema && (
        <SchemaModal
          isShow
          onClose={hideSchema}
          rootName={name}
          schema={input_schema!}
        />
      )}
    </div>
  )
}
export default ToolFormItem
