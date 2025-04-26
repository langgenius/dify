import cn from '@/utils/classnames'
import type { LabelProps } from '../label'
import { useFieldContext } from '../..'
import Label from '../label'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import FileTypeItem from '@/app/components/workflow/nodes/_base/components/file-type-item'
import { useCallback } from 'react'

type FieldValue = {
  allowedFileTypes: string[],
  allowedFileExtensions: string[]
}

type FileTypesFieldProps = {
  label: string
  labelOptions?: Omit<LabelProps, 'htmlFor' | 'label'>
  className?: string
}

const FileTypesField = ({
  label,
  labelOptions,
  className,
}: FileTypesFieldProps) => {
  const field = useFieldContext<FieldValue>()

  const handleSupportFileTypeChange = useCallback((type: SupportUploadFileTypes) => {
    let newAllowFileTypes = [...field.state.value.allowedFileTypes]
    if (type === SupportUploadFileTypes.custom) {
      if (!newAllowFileTypes.includes(SupportUploadFileTypes.custom))
        newAllowFileTypes = [SupportUploadFileTypes.custom]
      else
        newAllowFileTypes = newAllowFileTypes.filter(v => v !== type)
    }
    else {
      newAllowFileTypes = newAllowFileTypes.filter(v => v !== SupportUploadFileTypes.custom)
      if (newAllowFileTypes.includes(type))
        newAllowFileTypes = newAllowFileTypes.filter(v => v !== type)
      else
        newAllowFileTypes.push(type)
    }
    field.handleChange({
      ...field.state.value,
      allowedFileTypes: newAllowFileTypes,
    })
  }, [field])

  const handleCustomFileTypesChange = useCallback((customFileTypes: string[]) => {
    field.handleChange({
      ...field.state.value,
      allowedFileExtensions: customFileTypes,
    })
  }, [field])

  return (
    <div className={cn('flex flex-col gap-y-0.5', className)}>
      <Label
        htmlFor={field.name}
        label={label}
        {...(labelOptions ?? {})}
      />
      {
        [SupportUploadFileTypes.document, SupportUploadFileTypes.image, SupportUploadFileTypes.audio, SupportUploadFileTypes.video].map((type: SupportUploadFileTypes) => (
          <FileTypeItem
            key={type}
            type={type as SupportUploadFileTypes.image | SupportUploadFileTypes.document | SupportUploadFileTypes.audio | SupportUploadFileTypes.video}
            selected={field.state.value.allowedFileTypes.includes(type)}
            onToggle={handleSupportFileTypeChange}
          />
        ))
      }
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
