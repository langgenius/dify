import type { TestFileRules } from './file-limits'
import type { TestAgentAttachment } from './use-test-files'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Field, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Fieldset, FieldsetLegend } from '@langgenius/dify-ui/fieldset'
import { Form } from '@langgenius/dify-ui/form'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Input } from '@langgenius/dify-ui/input'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatAgentMimeType } from '../../model'

export function TestAgentAttachments({
  attachments,
  rules,
  failure,
  disabled,
  onPaste,
  onUpload,
  onRetry,
  onRemove,
}: {
  attachments: TestAgentAttachment[]
  rules: TestFileRules | null
  failure: string | null
  disabled: boolean
  onPaste: (url: string) => boolean
  onUpload: (files: File[]) => boolean
  onRetry: (id: string) => void
  onRemove: (id: string) => void
}) {
  const { t } = useTranslation(['agentRoster', 'common'])
  const [linkOpen, setLinkOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const supportedTypesId = useId()
  const supportedTypes = rules?.fileTypes
    .map(
      ({ media_type, extensions }) =>
        `${formatAgentMimeType(media_type)} (${extensions.join(', ')})`,
    )
    .join(', ')
  const hint =
    failure ||
    (supportedTypes
      ? t(($) => $['external.overview.testRun.supportedFileTypes'], { types: supportedTypes })
      : null)
  const unavailable = disabled || !rules?.modes.length || rules.maxFiles === 0
  return (
    <Fieldset>
      <FieldsetLegend className="system-xs-medium">
        {t(($) => $['external.overview.attachments'])}
      </FieldsetLegend>
      <div className="flex gap-1">
        <input
          ref={fileInputRef}
          type="file"
          data-testid="external-agent-local-file-input"
          accept={rules?.fileTypes
            .flatMap(({ media_type, extensions }) => [media_type, ...extensions])
            .join(',')}
          multiple={!!rules && rules.maxFiles > 1}
          hidden
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? [])
            event.currentTarget.value = ''
            if (files.length) onUpload(files)
          }}
        />
        <Button
          type="button"
          variant="tertiary"
          size="large"
          disabled={unavailable}
          aria-describedby={hint ? supportedTypesId : undefined}
          onClick={() => fileInputRef.current?.click()}
          className="h-auto min-h-9 min-w-0 flex-1 rounded-lg px-2 py-2 whitespace-normal"
        >
          <span aria-hidden className="i-ri-upload-cloud-2-line size-4 shrink-0" />
          {t(($) => $['external.overview.localUpload'])}
        </Button>
        <Popover open={linkOpen} onOpenChange={setLinkOpen}>
          <PopoverTrigger
            render={
              <Button
                type="button"
                variant="tertiary"
                size="large"
                disabled={unavailable}
                aria-describedby={hint ? supportedTypesId : undefined}
                className="h-auto min-h-9 min-w-0 flex-1 rounded-lg px-2 py-2 whitespace-normal"
              />
            }
          >
            <span aria-hidden className="i-ri-link size-4 shrink-0" />
            {t(($) => $['external.overview.pasteFileLink'])}
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] p-4">
            <PopoverTitle className="mb-2 system-sm-semibold text-text-primary">
              {t(($) => $['external.overview.pasteFileLink'])}
            </PopoverTitle>
            <Form<{ url: string }>
              className="space-y-3"
              onFormSubmit={(values) => {
                if (onPaste(values.url.trim())) setLinkOpen(false)
              }}
            >
              <Field
                name="url"
                validate={(value) =>
                  typeof value === 'string' && URL.parse(value.trim())?.protocol === 'https:'
                    ? null
                    : t(($) => $['external.overview.testRun.fileLinkHTTPS'])
                }
              >
                <FieldLabel>{t(($) => $['external.overview.fileLink'])}</FieldLabel>
                <Input inputMode="url" autoComplete="off" />
                <FieldError />
              </Field>
              <div className="flex justify-end">
                <Button type="submit" variant="primary">
                  {t(($) => $['operation.add'], { ns: 'common' })}
                </Button>
              </div>
            </Form>
          </PopoverContent>
        </Popover>
      </div>
      {hint && (
        <p
          id={supportedTypesId}
          role={failure ? 'alert' : undefined}
          className={cn(
            'mt-1 system-xs-regular',
            failure ? 'text-text-destructive' : 'text-text-tertiary',
          )}
        >
          {hint}
        </p>
      )}
      {attachments.length > 0 && (
        <ul className="mt-2 space-y-1">
          {attachments.map((attachment) => (
            <li key={attachment.id} className="rounded-lg bg-background-section p-2">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={
                    attachment.state === 'uploading'
                      ? 'i-ri-loader-2-line size-4 shrink-0 animate-spin motion-reduce:animate-none'
                      : attachment.state === 'error'
                        ? 'i-ri-file-warning-line size-4 shrink-0 text-text-destructive'
                        : 'i-ri-attachment-2 size-4 shrink-0 text-text-tertiary'
                  }
                />
                <span className="min-w-0 flex-1 system-xs-regular break-all text-text-secondary">
                  {attachment.name}
                </span>
                {attachment.state === 'error' && (
                  <Button
                    type="button"
                    size="small"
                    variant="ghost"
                    disabled={disabled}
                    aria-label={t(($) => $['external.overview.testRun.retryFile'], {
                      name: attachment.name,
                    })}
                    onClick={() => onRetry(attachment.id)}
                  >
                    {t(($) => $['operation.retry'], { ns: 'common' })}
                  </Button>
                )}
                <IconButton
                  size="md"
                  disabled={disabled}
                  className="shrink-0"
                  aria-label={t(($) => $['external.overview.removeAttachment'], {
                    name: attachment.name,
                  })}
                  onClick={() => onRemove(attachment.id)}
                >
                  <span aria-hidden className="i-ri-close-line size-4" />
                </IconButton>
              </div>
              {attachment.error && (
                <p role="alert" className="mt-1 system-xs-regular text-text-destructive">
                  {attachment.error}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Fieldset>
  )
}
