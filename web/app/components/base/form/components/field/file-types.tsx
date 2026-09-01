import type { LabelProps } from '../label'
import { cn } from '@langgenius/dify-ui/cn'
import { useCallback } from 'react'
import FileTypeItem from '@/app/components/workflow/nodes/_base/components/file-type-item'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import { useFieldContext } from '../..'
import Label from '../label'

type FieldValue = {
  allowedFileTypes: string[]
  allowedFileExtensions: string[]
}

type FileTypesFieldProps = {
  label: string
  labelOptions?: Omit<LabelProps, 'htmlFor' | 'label'>
  className?: string
}

const FileTypesField = ({ label, labelOptions, className }: FileTypesFieldProps) => {
  const field = useFieldContext<FieldValue>()

  const handleSupportFileTypeChange = useCallback(
    (type: SupportUploadFileTypes) => {
      const current = field.state.value.allowedFileTypes
      const nextAllowFileTypes = current.includes(type)
        ? current.filter((v) => v !== type)
        : [...current, type]
      field.handleChange({
        ...field.state.value,
        allowedFileTypes: nextAllowFileTypes,
      })
    },
    [field],
  )

  const handleCustomFileTypesChange = useCallback(
    (customFileTypes: string[]) => {
      field.handleChange({
        ...field.state.value,
        allowedFileExtensions: customFileTypes,
      })
    },
    [field],
  )

  return (
    <div className={cn('flex flex-col gap-y-0.5', className)}>
      <Label htmlFor={field.name} label={label} {...(labelOptions ?? {})} />
      {[
        SupportUploadFileTypes.document,
        SupportUploadFileTypes.image,
        SupportUploadFileTypes.audio,
        SupportUploadFileTypes.video,
      ].map((type: SupportUploadFileTypes) => (
        <FileTypeItem
          key={type}
          type={
            type as
              | SupportUploadFileTypes.image
              | SupportUploadFileTypes.document
              | SupportUploadFileTypes.audio
              | SupportUploadFileTypes.video
          }
          selected={field.state.value.allowedFileTypes.includes(type)}
          onToggle={handleSupportFileTypeChange}
        />
      ))}
      <FileTypeItem
        type={SupportUploadFileTypes.custom}
        selected={field.state.value.allowedFileTypes.includes(SupportUploadFileTypes.custom)}
        onToggle={handleSupportFileTypeChange}
        customFileTypes={field.state.value.allowedFileExtensions}
        onCustomFileTypesChange={handleCustomFileTypesChange}
      />
    </div>
  )
}

export default FileTypesField
