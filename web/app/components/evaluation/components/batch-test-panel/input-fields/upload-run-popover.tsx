import type { ChangeEvent, DragEvent } from 'react'
import type { InputField } from './input-fields-utils'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
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
  const { t } = useTranslation('evaluation')
  const { t: tCommon } = useTranslation('common')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const previewFields = inputFields.slice(0, 3)
  const booleanExampleValue = t('conditions.boolean.true')

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
        render={(
          <Button className="w-full justify-center" variant="primary" disabled={triggerDisabled}>
            {triggerLabel ?? t('batch.uploadAndRun')}
          </Button>
        )}
      />
      <PopoverContent
        placement="bottom-end"
        sideOffset={8}
        popupClassName="w-[402px] overflow-hidden rounded-lg border border-components-panel-border p-0 shadow-[0px_20px_24px_-4px_rgba(9,9,11,0.08),0px_8px_8px_-4px_rgba(9,9,11,0.03)]"
      >
        <div className="flex flex-col bg-components-panel-bg">
          <div className="flex flex-col gap-4 p-4">
            <input
              ref={fileInputRef}
              hidden
              type="file"
              accept=".csv"
              onChange={handleFileChange}
            />
            {currentFileName
              ? (
                  <div className="flex h-20 items-center gap-3 rounded-lg border border-components-panel-border bg-components-panel-on-panel-item-bg px-3">
                    <div className="flex p-3">
                      <span aria-hidden="true" className="i-ri-file-excel-fill h-6 w-6 text-util-colors-green-green-600" />
                    </div>
                    <div className="min-w-0 flex-1 py-1 pr-2">
                      <div className="truncate system-xs-medium text-text-secondary">
                        {currentFileName}
                      </div>
                      <div className="mt-0.5 flex h-3 items-center gap-1 system-2xs-medium text-text-tertiary">
                        {!!currentFileExtension && <span className="uppercase">{currentFileExtension}</span>}
                        {!!currentFileExtension && !!currentFileSize && <span className="text-text-quaternary">·</span>}
                        {!!currentFileSize && <span>{currentFileSize}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 pr-3">
                      {isFileUploading && (
                        <span aria-hidden="true" className="i-ri-loader-4-line h-4 w-4 animate-spin text-text-accent" />
                      )}
                      <button
                        type="button"
                        className="rounded-md p-1 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary"
                        onClick={onClearUploadedFile}
                        aria-label={t('batch.removeUploadedFile')}
                      >
                        <span aria-hidden="true" className="i-ri-delete-bin-line h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )
              : (
                  <div
                    className="flex h-20 w-full items-center justify-center gap-3 rounded-xl border border-dashed border-components-dropzone-border bg-components-dropzone-bg p-3 text-left hover:border-components-button-secondary-border"
                    onDragOver={event => event.preventDefault()}
                    onDrop={handleDropFile}
                  >
                    <button
                      type="button"
                      className="flex shrink-0 p-3"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <span aria-hidden="true" className="i-ri-file-upload-line h-6 w-6 text-text-tertiary" />
                      <span className="sr-only">{t('batch.uploadTitle')}</span>
                    </button>
                    <div className="min-w-0 flex-1 text-left">
                      <div className="system-md-regular text-text-secondary">
                        {t('batch.uploadDropzonePrefix')}
                        {' '}
                        <span className="system-md-semibold">{t('batch.uploadDropzoneEmphasis')}</span>
                        {' '}
                        {t('batch.uploadDropzoneSuffix')}
                      </div>
                      <div className="mt-0.5 system-xs-regular text-text-tertiary">
                        <button
                          type="button"
                          className="text-text-accent hover:underline"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          {t('batch.uploadDropzoneUploadButton')}
                        </button>
                        {' '}
                        {t('batch.uploadHint')}
                      </div>
                    </div>
                  </div>
                )}

            {!!previewFields.length && (
              <div className="space-y-1">
                <div className="system-md-semibold text-text-secondary">{t('batch.example')}</div>
                <div className="flex overflow-hidden rounded-lg border border-divider-regular">
                  {previewFields.map((field, index) => (
                    <div key={field.name} className={cn('min-w-0 flex-1', index < previewFields.length - 1 && 'border-r border-divider-subtle')}>
                      <div className="min-h-8 border-b border-divider-regular px-3 py-2 system-xs-medium-uppercase text-text-tertiary">
                        {field.name}
                      </div>
                      <div className="min-h-8 px-3 py-2 system-sm-regular text-text-secondary">
                        {getExampleValue(field, booleanExampleValue)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="flex items-end justify-end gap-2 border-t border-components-panel-border px-4 py-4">
            <Button variant="secondary" className="rounded-lg" onClick={() => onOpenChange(false)}>
              {tCommon('operation.cancel')}
            </Button>
            <Button className="flex-1 justify-center rounded-lg" variant="primary" disabled={isRunDisabled} loading={isRunning} onClick={onRun}>
              <span aria-hidden="true" className="mr-1 i-ri-play-fill h-5 w-5" />
              {t('batch.run')}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default UploadRunPopover
