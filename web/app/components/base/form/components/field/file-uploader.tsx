import React from 'react'
import { useFieldContext } from '../..'
import type { LabelProps } from '../label'
import Label from '../label'
import cn from '@/utils/classnames'
import type { FileUploaderInAttachmentWrapperProps } from '../../../file-uploader/file-uploader-in-attachment'
import FileUploaderInAttachmentWrapper from '../../../file-uploader/file-uploader-in-attachment'
import type { FileEntity } from '../../../file-uploader/types'

type FileUploaderFieldProps = {
  label: string
  labelOptions?: Omit<LabelProps, 'htmlFor' | 'label'>
  className?: string
} & Omit<FileUploaderInAttachmentWrapperProps, 'value' | 'onChange'>

const FileUploaderField = ({
  label,
  labelOptions,
  className,
  ...inputProps
}: FileUploaderFieldProps) => {
  const field = useFieldContext<FileEntity[]>()

  return (
    <div className={cn('flex flex-col gap-y-0.5', className)}>
      <Label
        htmlFor={field.name}
        label={label}
        {...(labelOptions ?? {})}
      />
      <FileUploaderInAttachmentWrapper
        value={field.state.value}
        onChange={value => field.handleChange(value)}
        {...inputProps}
      />
    </div>
  )
}

export default FileUploaderField
