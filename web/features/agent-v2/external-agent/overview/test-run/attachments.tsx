import { Button } from '@langgenius/dify-ui/button'
import { Field, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Fieldset, FieldsetLegend } from '@langgenius/dify-ui/fieldset'
import { Form } from '@langgenius/dify-ui/form'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Input } from '@langgenius/dify-ui/input'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export type TestAgentAttachment =
  | { id: string; name: string; file: File }
  | { id: string; name: string; url: string }

export function TestAgentAttachments({
  attachments,
  onChange,
}: {
  attachments: TestAgentAttachment[]
  onChange: (attachments: TestAgentAttachment[]) => void
}) {
  const { t } = useTranslation(['agentRoster', 'common'])
  const [linkOpen, setLinkOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  return (
    <Fieldset>
      <FieldsetLegend className="system-xs-medium">
        {t(($) => $['external.overview.attachments'])}
      </FieldsetLegend>
      <div className="flex gap-1">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          aria-label={t(($) => $['external.overview.localUpload'])}
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? [])
            if (!files.length) return
            onChange([
              ...attachments,
              ...files.map((file) => ({ id: crypto.randomUUID(), name: file.name, file })),
            ])
            event.currentTarget.value = ''
          }}
        />
        <Button
          type="button"
          variant="tertiary"
          size="large"
          className="h-auto min-h-9 min-w-0 flex-1 rounded-lg px-2 py-2 whitespace-normal"
          onClick={() => fileInputRef.current?.click()}
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
              onFormSubmit={({ url }) => {
                onChange([
                  ...attachments,
                  { id: crypto.randomUUID(), name: url.trim(), url: url.trim() },
                ])
                setLinkOpen(false)
              }}
            >
              <Field
                name="url"
                validate={(value) => {
                  const url = typeof value === 'string' ? URL.parse(value.trim()) : null
                  return url && ['http:', 'https:'].includes(url.protocol)
                    ? null
                    : t(($) => $['external.overview.invalidFileLink'])
                }}
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
      {attachments.length > 0 && (
        <ul className="mt-2 space-y-1">
          {attachments.map((attachment) => (
            <li
              key={attachment.id}
              className="flex items-center gap-2 rounded-lg bg-background-section p-2"
            >
              <span aria-hidden className="i-ri-attachment-2 size-4 shrink-0 text-text-tertiary" />
              <span className="min-w-0 flex-1 system-xs-regular break-all text-text-secondary">
                {attachment.name}
              </span>
              <IconButton
                size="md"
                className="shrink-0"
                aria-label={t(($) => $['external.overview.removeAttachment'], {
                  name: attachment.name,
                })}
                onClick={() => {
                  onChange(attachments.filter(({ id }) => id !== attachment.id))
                }}
              >
                <span aria-hidden className="i-ri-close-line size-4" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </Fieldset>
  )
}
