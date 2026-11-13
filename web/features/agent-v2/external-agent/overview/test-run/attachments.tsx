import type { TestFileRules } from './file-limits'
import type { TestAgentAttachment } from './use-test-files'
import { Button } from '@langgenius/dify-ui/button'
import { Field, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Fieldset, FieldsetLegend } from '@langgenius/dify-ui/fieldset'
import { Form } from '@langgenius/dify-ui/form'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Input } from '@langgenius/dify-ui/input'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@langgenius/dify-ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
  SelectValue,
} from '@langgenius/dify-ui/select'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatAgentMimeType } from '../../model'
import { suggestedLinkFile } from './file-limits'

export function TestAgentAttachments({
  attachments,
  rules,
  failure,
  disabled,
  onPaste,
  onUpload,
  onRemove,
}: {
  attachments: TestAgentAttachment[]
  rules: TestFileRules | null
  failure: string | null
  disabled: boolean
  onPaste: (url: string, name: string, mediaType: string) => boolean
  onUpload: (files: File[]) => boolean
  onRemove: (id: string) => void
}) {
  const { t } = useTranslation(['agentRoster', 'common'])
  const [linkOpen, setLinkOpen] = useState(false)
  const [filename, setFilename] = useState('')
  const [mediaType, setMediaType] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const unavailable = disabled || !rules?.modes.length || rules.maxFiles === 0
  const mimeOptions = (rules?.modes ?? []).map((value) => ({
    value,
    label: formatAgentMimeType(value),
  }))
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
          accept={rules?.modes.join(',')}
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
            <Form<{ url: string; filename: string; mediaType: string }>
              className="space-y-3"
              onFormSubmit={(values) => {
                if (onPaste(values.url.trim(), values.filename.trim(), values.mediaType))
                  setLinkOpen(false)
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
                <Input
                  inputMode="url"
                  autoComplete="off"
                  onValueChange={(value) => {
                    const suggested = suggestedLinkFile(value)
                    setFilename(suggested.name)
                    setMediaType(rules?.modes.includes(suggested.mime) ? suggested.mime : null)
                  }}
                />
                <FieldError />
              </Field>
              <Field
                name="filename"
                validate={(value) =>
                  typeof value === 'string' &&
                  value.trim() &&
                  value.length <= 255 &&
                  !/[/\\\0\r\n]/.test(value)
                    ? null
                    : t(($) => $['errorMsg.fieldRequired'], {
                        ns: 'common',
                        field: t(($) => $['external.overview.testRun.fileName']),
                      })
                }
              >
                <FieldLabel>{t(($) => $['external.overview.testRun.fileName'])}</FieldLabel>
                <Input
                  value={filename}
                  onValueChange={setFilename}
                  maxLength={255}
                  autoComplete="off"
                  required
                />
                <FieldError />
              </Field>
              <Field
                name="mediaType"
                validate={(value) =>
                  typeof value === 'string' && rules?.modes.includes(value)
                    ? null
                    : t(($) => $['external.overview.testRun.fileTypeUnsupported'])
                }
              >
                <FieldLabel>{t(($) => $['external.overview.testRun.fileMediaType'])}</FieldLabel>
                <Select
                  name="mediaType"
                  items={mimeOptions}
                  value={mediaType}
                  onValueChange={setMediaType}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {mimeOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        <SelectItemText>{option.label}</SelectItemText>
                        <SelectItemIndicator />
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
      {failure && (
        <p role="alert" className="mt-2 system-xs-regular text-text-destructive">
          {failure}
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
                      : 'i-ri-attachment-2 size-4 shrink-0 text-text-tertiary'
                  }
                />
                <span className="min-w-0 flex-1 system-xs-regular break-all text-text-secondary">
                  {attachment.name}
                </span>
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
