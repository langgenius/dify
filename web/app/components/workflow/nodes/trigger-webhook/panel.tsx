import type { FC } from 'react'
import React, { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { RiExternalLinkLine, RiFileCopyLine } from '@remixicon/react'
import type { HttpMethod, WebhookTriggerNodeType } from './types'
import useConfig from './use-config'
import ParameterList from './components/parameter-list'
import HeaderList from './components/header-list'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import type { NodePanelProps } from '@/app/components/workflow/types'
import Input from '@/app/components/base/input'
import Select from '@/app/components/base/select'
import Switch from '@/app/components/base/switch'
import Toast from '@/app/components/base/toast'

const i18nPrefix = 'workflow.nodes.triggerWebhook'

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
  // follow prototype strictly, add `forms` option (non-standard MIME, UI only)
  { name: 'forms', value: 'forms' },
  { name: 'multipart/form-data', value: 'multipart/form-data' },
]

const Panel: FC<NodePanelProps<WebhookTriggerNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()
  const {
    readOnly,
    inputs,
    handleMethodChange,
    handleContentTypeChange,
    handleHeadersChange,
    handleParamsChange,
    handleBodyChange,
    handleAsyncModeChange,
    handleStatusCodeChange,
    handleResponseBodyChange,
    generateWebhookUrl,
  } = useConfig(id, data)

  // auto-generate webhook url when empty to match prototype (no explicit generate button)
  useEffect(() => {
    if (!inputs.webhook_url)
      generateWebhookUrl()
  }, [generateWebhookUrl, inputs.webhook_url])

  const handleCopyUrl = useCallback(() => {
    if (inputs.webhook_url) {
      navigator.clipboard.writeText(inputs.webhook_url)
      Toast.notify({
        type: 'success',
        message: t(`${i18nPrefix}.urlCopied`),
      })
    }
  }, [inputs.webhook_url, t])

  return (
    <div className='mt-2'>
      <div className='space-y-4 px-4 pb-3 pt-2'>
        {/* Webhook URL Section (method selector + url input in one row) */}
        <Field title={t(`${i18nPrefix}.webhookUrl`)}>
          <div className="space-y-2">
            <div className="flex gap-2">
              {/* method selector placed on the left to follow prototype */}
              <div className="w-28 shrink-0">
                <Select
                  items={HTTP_METHODS}
                  defaultValue={inputs.method}
                  onSelect={item => handleMethodChange(item.value as HttpMethod)}
                  disabled={readOnly}
                  allowSearch={false}
                />
              </div>
              <div className="flex-1">
                <Input
                  value={inputs.webhook_url || ''}
                  placeholder={t(`${i18nPrefix}.webhookUrlPlaceholder`)}
                  readOnly
                  className="bg-gray-50"
                />
              </div>
            </div>
            {inputs.webhook_url && (
              <div className="flex gap-2 text-xs">
                <button
                  onClick={handleCopyUrl}
                  className="flex items-center gap-1 text-primary-600 hover:text-primary-700"
                >
                  <RiFileCopyLine className="h-3 w-3" />
                  {t(`${i18nPrefix}.copy`)}
                </button>
                <a
                  href={inputs.webhook_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-primary-600 hover:text-primary-700"
                >
                  <RiExternalLinkLine className="h-3 w-3" />
                  {t(`${i18nPrefix}.test`)}
                </a>
              </div>
            )}
          </div>
        </Field>

        <Split />

        {/* Content Type */}
        <Field title={t(`${i18nPrefix}.contentType`)}>
          <Select
            items={CONTENT_TYPES}
            defaultValue={inputs['content-type']}
            onSelect={item => handleContentTypeChange(item.value as string)}
            disabled={readOnly}
            allowSearch={false}
          />
        </Field>

        <Split />

        {/* Query Parameters */}
        <Field title={t(`${i18nPrefix}.queryParameters`)}>
          <ParameterList
            readonly={readOnly}
            title={t(`${i18nPrefix}.queryParameters`)}
            parameters={inputs.params}
            onChange={handleParamsChange}
            placeholder={t(`${i18nPrefix}.noQueryParameters`)}
            // hide type column to match prototype
            showType={false}
          />
        </Field>

        <Split />

        {/* Header Parameters */}
        <Field title={t(`${i18nPrefix}.headerParameters`)}>
          <HeaderList
            readonly={readOnly}
            headers={inputs.headers}
            onChange={handleHeadersChange}
          />
        </Field>

        <Split />

        {/* Request Body Parameters */}
        <Field title={t(`${i18nPrefix}.requestBodyParameters`)}>
          <ParameterList
            readonly={readOnly}
            title={t(`${i18nPrefix}.requestBodyParameters`)}
            parameters={inputs.body}
            onChange={handleBodyChange}
            placeholder={t(`${i18nPrefix}.noBodyParameters`)}
          />
        </Field>

        <Split />

        {/* Response Configuration */}
        <Field title={t(`${i18nPrefix}.responseConfiguration`)}>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">
                {t(`${i18nPrefix}.asyncMode`)}
              </span>
              <Switch
                defaultValue={inputs.async_mode}
                onChange={handleAsyncModeChange}
                disabled={readOnly}
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                {t(`${i18nPrefix}.statusCode`)}
              </label>
              <Input
                type="number"
                value={inputs.status_code}
                onChange={e => handleStatusCodeChange(Number(e.target.value))}
                disabled={readOnly}
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                {t(`${i18nPrefix}.responseBody`)}
              </label>
              <Input
                value={inputs.response_body}
                onChange={e => handleResponseBodyChange(e.target.value)}
                disabled={readOnly}
              />
            </div>
          </div>
        </Field>
      </div>
    </div>
  )
}

export default Panel
