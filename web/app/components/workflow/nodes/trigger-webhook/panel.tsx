import type { FC } from 'react'
import type { HttpMethod, WebhookTriggerNodeType } from './types'
import type { NodePanelProps } from '@/app/components/workflow/types'

import copy from 'copy-to-clipboard'
import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { InputNumber } from '@/app/components/base/input-number'
import InputWithCopy from '@/app/components/base/input-with-copy'
import { SimpleSelect } from '@/app/components/base/select'
import Toast from '@/app/components/base/toast'
import Tooltip from '@/app/components/base/tooltip'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import OutputVars from '@/app/components/workflow/nodes/_base/components/output-vars'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import { isPrivateOrLocalAddress } from '@/utils/urlValidation'
import HeaderTable from './components/header-table'
import ParagraphInput from './components/paragraph-input'
import ParameterTable from './components/parameter-table'
import useConfig from './use-config'
import { OutputVariablesContent } from './utils/render-output-vars'

const i18nPrefix = 'nodes.triggerWebhook'

const HTTP_METHODS = [
  { name: 'GET', value: 'GET' },
  { name: 'POST', value: 'POST' },
  { name: 'PUT', value: 'PUT' },
  { name: 'DELETE', value: 'DELETE' },
  { name: 'PATCH', value: 'PATCH' },
  { name: 'HEAD', value: 'HEAD' },
]

const CONTENT_TYPES = [
  { name: 'application/json', value: 'application/json' },
  { name: 'application/x-www-form-urlencoded', value: 'application/x-www-form-urlencoded' },
  { name: 'text/plain', value: 'text/plain' },
  { name: 'application/octet-stream', value: 'application/octet-stream' },
  { name: 'multipart/form-data', value: 'multipart/form-data' },
]

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
    handleStatusCodeBlur,
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

  return (
    <div className="mt-2">
      <div className="space-y-4 px-4 pb-3 pt-2">
        {/* Webhook URL Section */}
        <Field title={t(`${i18nPrefix}.webhookUrl`, { ns: 'workflow' })}>
          <div className="space-y-1">
            <div className="flex gap-1" style={{ height: '32px' }}>
              <div className="w-26 shrink-0">
                <SimpleSelect
                  items={HTTP_METHODS}
                  defaultValue={inputs.method}
                  onSelect={item => handleMethodChange(item.value as HttpMethod)}
                  disabled={readOnly}
                  className="h-8 pr-8 text-sm"
                  wrapperClassName="h-8"
                  optionWrapClassName="w-26 min-w-26 z-[5]"
                  allowSearch={false}
                  notClearable={true}
                />
              </div>
              <div className="flex-1" style={{ width: '284px' }}>
                <InputWithCopy
                  value={inputs.webhook_url || ''}
                  placeholder={t(`${i18nPrefix}.webhookUrlPlaceholder`, { ns: 'workflow' })}
                  readOnly
                  onCopy={() => {
                    Toast.notify({
                      type: 'success',
                      message: t(`${i18nPrefix}.urlCopied`, { ns: 'workflow' }),
                    })
                  }}
                />
              </div>
            </div>
            {inputs.webhook_debug_url && (
              <div className="space-y-2">
                <Tooltip
                  popupContent={debugUrlCopied ? t(`${i18nPrefix}.debugUrlCopied`, { ns: 'workflow' }) : t(`${i18nPrefix}.debugUrlCopy`, { ns: 'workflow' })}
                  popupClassName="system-xs-regular text-text-primary bg-components-tooltip-bg border border-components-panel-border shadow-lg backdrop-blur-sm rounded-md px-1.5 py-1"
                  position="top"
                  offset={{ mainAxis: -20 }}
                  needsDelay={true}
                >
                  <div
                    className="flex cursor-pointer gap-1.5 rounded-lg px-1 py-1.5 transition-colors"
                    style={{ width: '368px', height: '38px' }}
                    onClick={() => {
                      copy(inputs.webhook_debug_url || '')
                      setDebugUrlCopied(true)
                      setTimeout(() => setDebugUrlCopied(false), 2000)
                    }}
                  >
                    <div className="mt-0.5 w-0.5 bg-divider-regular" style={{ height: '28px' }}></div>
                    <div className="flex-1" style={{ width: '352px', height: '32px' }}>
                      <div className="text-xs leading-4 text-text-tertiary">
                        {t(`${i18nPrefix}.debugUrlTitle`, { ns: 'workflow' })}
                      </div>
                      <div className="truncate text-xs leading-4 text-text-primary">
                        {inputs.webhook_debug_url}
                      </div>
                    </div>
                  </div>
                </Tooltip>
                {isPrivateOrLocalAddress(inputs.webhook_debug_url) && (
                  <div className="system-xs-regular mt-1 px-0 py-[2px] text-text-warning">
                    {t(`${i18nPrefix}.debugUrlPrivateAddressWarning`, { ns: 'workflow' })}
                  </div>
                )}
              </div>
            )}
          </div>
        </Field>

        {/* Content Type */}
        <Field title={t(`${i18nPrefix}.contentType`, { ns: 'workflow' })}>
          <div className="w-full">
            <SimpleSelect
              items={CONTENT_TYPES}
              defaultValue={inputs.content_type}
              onSelect={item => handleContentTypeChange(item.value as string)}
              disabled={readOnly}
              className="h-8 text-sm"
              wrapperClassName="h-8"
              optionWrapClassName="min-w-48 z-[5]"
              allowSearch={false}
              notClearable={true}
            />
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
              <InputNumber
                value={inputs.status_code}
                onChange={(value) => {
                  handleStatusCodeChange(value || 200)
                }}
                disabled={readOnly}
                wrapClassName="w-[120px]"
                className="h-8"
                defaultValue={200}
                onBlur={() => {
                  handleStatusCodeBlur(inputs.status_code)
                }}
              />
            </div>
            <div>
              <label className="system-sm-medium mb-2 block text-text-tertiary">
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
