import type { FC } from 'react'
import type { HttpMethod, WebhookTriggerNodeType } from './types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import {
  NumberField,
  NumberFieldControls,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from '@langgenius/dify-ui/number-field'
import { Select, SelectContent, SelectItem, SelectItemIndicator, SelectItemText, SelectTrigger } from '@langgenius/dify-ui/select'
import { toast } from '@langgenius/dify-ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import copy from 'copy-to-clipboard'
import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import InputWithCopy from '@/app/components/base/input-with-copy'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import OutputVars from '@/app/components/workflow/nodes/_base/components/output-vars'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import { isPrivateOrLocalAddress } from '@/utils/urlValidation'
import HeaderTable from './components/header-table'
import ParagraphInput from './components/paragraph-input'
import ParameterTable from './components/parameter-table'
import { DEFAULT_STATUS_CODE, MAX_STATUS_CODE, normalizeStatusCode, useConfig } from './use-config'
import { OutputVariablesContent } from './utils/render-output-vars'

const i18nPrefix = 'nodes.triggerWebhook'

const HTTP_METHODS = [
  { name: 'GET', value: 'GET' },
  { name: 'POST', value: 'POST' },
  { name: 'PUT', value: 'PUT' },
  { name: 'DELETE', value: 'DELETE' },
  { name: 'PATCH', value: 'PATCH' },
  { name: 'HEAD', value: 'HEAD' },
] satisfies Array<{ name: string, value: HttpMethod }>

const CONTENT_TYPES = [
  { name: 'application/json', value: 'application/json' },
  { name: 'application/x-www-form-urlencoded', value: 'application/x-www-form-urlencoded' },
  { name: 'text/plain', value: 'text/plain' },
  { name: 'application/octet-stream', value: 'application/octet-stream' },
  { name: 'multipart/form-data', value: 'multipart/form-data' },
]

type WebhookMethodSelectorProps = {
  nodeId: string
  label: string
  value: HttpMethod
  disabled: boolean
  onChange: (method: HttpMethod) => void
}

const WebhookMethodSelector = ({
  nodeId,
  label,
  value,
  disabled,
  onChange,
}: WebhookMethodSelectorProps) => {
  const selectedMethod = HTTP_METHODS.find(item => item.value === value) ?? null

  const handleMethodChange = (nextValue: string | null) => {
    const nextMethod = HTTP_METHODS.find(item => item.value === nextValue)
    if (nextMethod)
      onChange(nextMethod.value)
  }

  return (
    <Select
      key={`${nodeId}-method-${value}`}
      value={selectedMethod?.value ?? null}
      disabled={disabled}
      onValueChange={handleMethodChange}
    >
      <SelectTrigger aria-label={label} className="h-8 pr-8 text-sm">
        {selectedMethod?.name}
      </SelectTrigger>
      <SelectContent popupClassName="w-26 min-w-26">
        {HTTP_METHODS.map(item => (
          <SelectItem key={item.value} value={item.value}>
            <SelectItemText>{item.name}</SelectItemText>
            <SelectItemIndicator />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

const Panel: FC<NodePanelProps<WebhookTriggerNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()
  const [debugUrlCopied, setDebugUrlCopied] = React.useState(false)
  const [outputVarsCollapsed, setOutputVarsCollapsed] = useState(false)
  const {
    readOnly,
    inputs,
    handleMethodChange,
    handleContentTypeChange,
    handleHeadersChange,
    handleParamsChange,
    handleBodyChange,
    handleStatusCodeChange,
    handleResponseBodyChange,
    generateWebhookUrl,
  } = useConfig(id, data)

  // Ensure we only attempt to generate URL once for a newly created node without url
  const hasRequestedUrlRef = useRef(false)
  useEffect(() => {
    if (!readOnly && !inputs.webhook_url && !hasRequestedUrlRef.current) {
      hasRequestedUrlRef.current = true
      void generateWebhookUrl()
    }
  }, [readOnly, inputs.webhook_url, generateWebhookUrl])

  const selectedContentType = CONTENT_TYPES.find(item => item.value === inputs.content_type) ?? null

  return (
    <div className="mt-2">
      <div className="space-y-4 px-4 pt-2 pb-3">
        {/* Webhook URL Section */}
        <Field title={t(`${i18nPrefix}.webhookUrl`, { ns: 'workflow' })}>
          <div className="space-y-1">
            <div className="flex gap-1" style={{ height: '32px' }}>
              <div className="w-26 shrink-0">
                <WebhookMethodSelector
                  nodeId={id}
                  label={t(`${i18nPrefix}.method`, { ns: 'workflow' })}
                  value={inputs.method}
                  disabled={readOnly}
                  onChange={handleMethodChange}
                />
              </div>
              <div className="flex-1" style={{ width: '284px' }}>
                <InputWithCopy
                  value={inputs.webhook_url || ''}
                  placeholder={t(`${i18nPrefix}.webhookUrlPlaceholder`, { ns: 'workflow' })}
                  readOnly
                  onCopy={() => {
                    toast.success(t(`${i18nPrefix}.urlCopied`, { ns: 'workflow' }))
                  }}
                />
              </div>
            </div>
            {inputs.webhook_debug_url && (
              <div className="space-y-2">
                <Tooltip>
                  <TooltipTrigger
                    render={(
                      <button
                        type="button"
                        aria-label={t(`${i18nPrefix}.debugUrlCopy`, { ns: 'workflow' })}
                        className="flex cursor-pointer gap-1.5 rounded-lg px-1 py-1.5 text-left transition-colors"
                        style={{ width: '368px', height: '38px' }}
                        onClick={() => {
                          copy(inputs.webhook_debug_url || '')
                          setDebugUrlCopied(true)
                          setTimeout(() => setDebugUrlCopied(false), 2000)
                        }}
                      >
                        <span className="mt-0.5 w-0.5 bg-divider-regular" style={{ height: '28px' }} />
                        <span className="flex-1" style={{ width: '352px', height: '32px' }}>
                          <span className="block text-xs leading-4 text-text-tertiary">
                            {t(`${i18nPrefix}.debugUrlTitle`, { ns: 'workflow' })}
                          </span>
                          <span className="block truncate text-xs leading-4 text-text-primary">
                            {inputs.webhook_debug_url}
                          </span>
                        </span>
                      </button>
                    )}
                  />
                  <TooltipContent
                    placement="top"
                    className="rounded-md border border-components-panel-border bg-components-tooltip-bg px-1.5 py-1 system-xs-regular text-text-primary shadow-lg backdrop-blur-xs"
                  >
                    {debugUrlCopied ? t(`${i18nPrefix}.debugUrlCopied`, { ns: 'workflow' }) : t(`${i18nPrefix}.debugUrlCopy`, { ns: 'workflow' })}
                  </TooltipContent>
                </Tooltip>
                {isPrivateOrLocalAddress(inputs.webhook_debug_url) && (
                  <div className="mt-1 px-0 py-[2px] system-xs-regular text-text-warning">
                    {t(`${i18nPrefix}.debugUrlPrivateAddressWarning`, { ns: 'workflow' })}
                  </div>
                )}
              </div>
            )}
          </div>
        </Field>

        {/* Content Type */}
        <Field title={t(`${i18nPrefix}.contentType`, { ns: 'workflow' })}>
          <div className="w-full max-w-[392px]">
            <Select
              key={`${id}-content-type-${inputs.content_type}`}
              value={selectedContentType?.value ?? null}
              disabled={readOnly}
              onValueChange={value => value && handleContentTypeChange(value)}
            >
              <SelectTrigger className="h-8 w-full text-sm">
                {selectedContentType?.name}
              </SelectTrigger>
              <SelectContent>
                {CONTENT_TYPES.map(item => (
                  <SelectItem key={item.value} value={item.value}>
                    <SelectItemText>{item.name}</SelectItemText>
                    <SelectItemIndicator />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </Field>

        {/* Query Parameters */}
        <ParameterTable
          readonly={readOnly}
          title="Query Parameters"
          parameters={inputs.params}
          onChange={handleParamsChange}
          placeholder={t(`${i18nPrefix}.noQueryParameters`, { ns: 'workflow' })}
        />

        {/* Header Parameters */}
        <HeaderTable
          readonly={readOnly}
          headers={inputs.headers}
          onChange={handleHeadersChange}
        />

        {/* Request Body Parameters */}
        <ParameterTable
          readonly={readOnly}
          title="Request Body Parameters"
          parameters={inputs.body}
          onChange={handleBodyChange}
          placeholder={t(`${i18nPrefix}.noBodyParameters`, { ns: 'workflow' })}
          contentType={inputs.content_type}
        />

        <Split />

        {/* Response Configuration */}
        <Field title={t(`${i18nPrefix}.responseConfiguration`, { ns: 'workflow' })}>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="system-sm-medium text-text-tertiary">
                {t(`${i18nPrefix}.statusCode`, { ns: 'workflow' })}
              </label>
              <NumberField
                className="w-[120px]"
                min={DEFAULT_STATUS_CODE}
                max={MAX_STATUS_CODE}
                value={inputs.status_code ?? DEFAULT_STATUS_CODE}
                disabled={readOnly}
                onValueChange={value => value !== null && handleStatusCodeChange(value)}
                onValueCommitted={(value, eventDetails) => {
                  if (eventDetails.reason === 'input-blur' || eventDetails.reason === 'input-clear')
                    handleStatusCodeChange(normalizeStatusCode(value ?? DEFAULT_STATUS_CODE))
                }}
              >
                <NumberFieldGroup>
                  <NumberFieldInput
                    className="h-8"
                  />
                  <NumberFieldControls>
                    <NumberFieldIncrement />
                    <NumberFieldDecrement />
                  </NumberFieldControls>
                </NumberFieldGroup>
              </NumberField>
            </div>
            <div>
              <label className="mb-2 block system-sm-medium text-text-tertiary">
                {t(`${i18nPrefix}.responseBody`, { ns: 'workflow' })}
              </label>
              <ParagraphInput
                value={inputs.response_body}
                onChange={handleResponseBodyChange}
                placeholder={t(`${i18nPrefix}.responseBodyPlaceholder`, { ns: 'workflow' })}
                disabled={readOnly}
              />
            </div>
          </div>
        </Field>
      </div>

      <Split />

      <div className="">
        <OutputVars
          collapsed={outputVarsCollapsed}
          onCollapse={setOutputVarsCollapsed}
        >
          <OutputVariablesContent variables={inputs.variables} />
        </OutputVars>
      </div>
    </div>
  )
}

export default Panel
