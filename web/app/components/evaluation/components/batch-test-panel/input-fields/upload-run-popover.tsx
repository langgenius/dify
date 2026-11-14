import type { ChangeEvent, DragEvent } from 'react'
import type { InputField } from './input-fields-utils'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { getExampleValue } from './input-fields-utils'

type UploadRunPopoverProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  triggerDisabled: boolean
  triggerLabel?: string
  inputFields: InputField[]
  currentFileName: string | null | undefined
  currentFileExtension: string
  currentFileSize: string | number
  isFileUploading: boolean
  isRunDisabled: boolean
  isRunning: boolean
  onUploadFile: (file: File | undefined) => void
  onClearUploadedFile: () => void
  onRun: () => void
}

const UploadRunPopover = ({
  open,
  onOpenChange,
  triggerDisabled,
  triggerLabel,
  inputFields,
  currentFileName,
  currentFileExtension,
  currentFileSize,
  isFileUploading,
  isRunDisabled,
  isRunning,
  onUploadFile,
  onClearUploadedFile,
  onRun,
}: UploadRunPopoverProps) => {
  const { t } = useTranslation(['evaluation'])
  const { t: tCommon } = useTranslation(['common'])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const previewFields = inputFields
  const booleanExampleValue = t(($) => $['conditions.boolean.true'])

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    onUploadFile(event.target.files?.[0])
    event.target.value = ''
  }

  const handleDropFile = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    onUploadFile(event.dataTransfer.files?.[0])
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <Button className="w-full justify-center" variant="primary" disabled={triggerDisabled}>
            {triggerLabel ?? t(($) => $['batch.uploadAndRun'])}
          </Button>
        }
      />
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={8}
        className="flex max-h-(--available-height) w-[402px] flex-col overflow-hidden rounded-lg border border-components-panel-border p-0 shadow-[0px_20px_24px_-4px_rgba(9,9,11,0.08),0px_8px_8px_-4px_rgba(9,9,11,0.03)]"
      >
        {/* The body scrolls on short viewports so the run actions stay visible. */}
        <div className="flex min-h-0 flex-1 flex-col bg-components-panel-bg">
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
            <input
              ref={fileInputRef}
              hidden
              type="file"
              accept=".xlsx,.csv"
              onChange={handleFileChange}
            />
            {currentFileName ? (
              <div className="flex h-20 items-center gap-3 rounded-lg border border-components-panel-border bg-components-panel-on-panel-item-bg px-3">
                <div className="flex p-3">
                  <span
                    aria-hidden="true"
                    className="i-ri-file-excel-fill h-6 w-6 text-util-colors-green-green-600"
                  />
                </div>
                <div className="min-w-0 flex-1 py-1 pe-2">
                  <div
                    className="truncate system-xs-medium text-text-secondary"
                    title={currentFileName}
                  >
                    {currentFileName}
                  </div>
                  <div className="mt-0.5 flex h-3 items-center gap-1 system-2xs-medium text-text-tertiary">
                    {!!currentFileExtension && (
                      <span className="uppercase">{currentFileExtension}</span>
                    )}
                    {!!currentFileExtension && !!currentFileSize && (
                      <span className="text-text-quaternary">·</span>
                    )}
                    {!!currentFileSize && <span>{currentFileSize}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1 pe-3">
                  {isFileUploading && (
                    <span
                      aria-hidden="true"
                      className="i-ri-loader-4-line h-4 w-4 animate-spin text-text-accent"
                    />
                  )}
                  <button
                    type="button"
                    className="rounded-md p-1 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary"
                    onClick={onClearUploadedFile}
                    aria-label={t(($) => $['batch.removeUploadedFile'])}
                  >
                    <span aria-hidden="true" className="i-ri-delete-bin-line h-4 w-4" />
                  </button>
                </div>
              </div>
            ) : (
              <div
                className="flex h-20 w-full items-center justify-center gap-3 rounded-xl border border-dashed border-components-dropzone-border bg-components-dropzone-bg p-3 text-start hover:border-components-button-secondary-border"
                onDragOver={(event) => event.preventDefault()}
                onDrop={handleDropFile}
              >
                <button
                  type="button"
                  className="flex shrink-0 p-3"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <span
                    aria-hidden="true"
                    className="i-ri-file-upload-line h-6 w-6 text-text-tertiary"
                  />
                  <span className="sr-only">{t(($) => $['batch.uploadTitle'])}</span>
                </button>
                <div className="min-w-0 flex-1 text-start">
                  <div className="system-md-regular text-text-secondary">
                    {t(($) => $['batch.uploadDropzonePrefix'])}{' '}
                    <span className="system-md-semibold">
                      {t(($) => $['batch.uploadDropzoneEmphasis'])}
                    </span>{' '}
                    {t(($) => $['batch.uploadDropzoneSuffix'])}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-1 system-xs-regular text-text-tertiary">
                    <button
                      type="button"
                      className="text-text-accent hover:underline"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {t(($) => $['batch.uploadDropzoneUploadButton'])}
                    </button>
                    <span aria-hidden="true" className="text-text-quaternary">
                      ·
                    </span>
                    <span>{t(($) => $['batch.uploadHint'])}</span>
                  </div>
                </div>
              </div>
            )}

            {!!previewFields.length && (
              <div className="space-y-1">
                <div className="system-md-semibold text-text-secondary">
                  {t(($) => $['batch.example'])}
                </div>
                {/* Mirrors the spreadsheet: columns keep their names on one line and scroll sideways. */}
                <div className="flex overflow-x-auto rounded-lg border border-divider-regular">
                  {previewFields.map((field, index) => (
                    <div
                      key={field.name}
                      className={cn(
                        'max-w-60 min-w-16 flex-auto shrink-0',
                        index < previewFields.length - 1 && 'border-e border-divider-subtle',
                      )}
                    >
                      <div
                        className="truncate border-b border-divider-regular px-3 py-2 system-xs-medium-uppercase whitespace-nowrap text-text-tertiary"
                        title={field.name}
                      >
                        {field.name}
                      </div>
                      <div className="truncate px-3 py-2 system-sm-regular whitespace-nowrap text-text-secondary">
                        {getExampleValue(field, booleanExampleValue)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-end justify-end gap-2 border-t border-components-panel-border px-4 py-4">
            <Button variant="secondary" className="rounded-lg" onClick={() => onOpenChange(false)}>
              {tCommon(($) => $['operation.cancel'])}
            </Button>
            <Button
              className="flex-1 justify-center rounded-lg"
              variant="primary"
              disabled={isRunDisabled}
              loading={isRunning}
              onClick={onRun}
            >
              <span aria-hidden="true" className="me-1 i-ri-play-fill h-5 w-5" />
              {t(($) => $['batch.run'])}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default UploadRunPopover
