import {
  useCallback,
} from 'react'
import {
  RiLink,
  RiUploadCloud2Line,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import FileFromLinkOrLocal from '../file-from-link-or-local'
import {
  FileContextProvider,
  useStore,
} from '../store'
import type { FileEntity } from '../types'
import FileInput from '../file-input'
import { useFile } from '../hooks'
import FileItem from './file-item'
import Button from '@/app/components/base/button'
import cn from '@/utils/classnames'
import type { FileUpload } from '@/app/components/base/features/types'
import { TransferMethod } from '@/types/app'

type Option = {
  value: string
  label: string
  icon: React.JSX.Element
}
type FileUploaderInAttachmentProps = {
  fileConfig: FileUpload
}
const FileUploaderInAttachment = ({
  fileConfig,
}: FileUploaderInAttachmentProps) => {
  const { t } = useTranslation()
  const files = useStore(s => s.files)
  const {
    handleRemoveFile,
    handleReUploadFile,
  } = useFile(fileConfig)
  const options = [
    {
      value: TransferMethod.local_file,
      label: t('common.fileUploader.uploadFromComputer'),
      icon: <RiUploadCloud2Line className='h-4 w-4' />,
    },
    {
      value: TransferMethod.remote_url,
      label: t('common.fileUploader.pasteFileLink'),
      icon: <RiLink className='h-4 w-4' />,
    },
  ]

  const renderButton = useCallback((option: Option, open?: boolean) => {
    return (
      <Button
        key={option.value}
        variant='tertiary'
        className={cn('relative grow', open && 'bg-components-button-tertiary-bg-hover')}
        disabled={!!(fileConfig.number_limits && files.length >= fileConfig.number_limits)}
      >
        {option.icon}
        <span className='ml-1'>{option.label}</span>
        {
          option.value === TransferMethod.local_file && (
            <FileInput fileConfig={fileConfig} />
          )
        }
      </Button>
    )
  }, [fileConfig, files.length])
  const renderTrigger = useCallback((option: Option) => {
    return (open: boolean) => renderButton(option, open)
  }, [renderButton])
  const renderOption = useCallback((option: Option) => {
    if (option.value === TransferMethod.local_file && fileConfig?.allowed_file_upload_methods?.includes(TransferMethod.local_file))
      return renderButton(option)

    if (option.value === TransferMethod.remote_url && fileConfig?.allowed_file_upload_methods?.includes(TransferMethod.remote_url)) {
      return (
        <FileFromLinkOrLocal
          key={option.value}
          showFromLocal={false}
          trigger={renderTrigger(option)}
          fileConfig={fileConfig}
        />
      )
    }
  }, [renderButton, renderTrigger, fileConfig])

  return (
    <div>
      <div className='flex items-center space-x-1'>
        {options.map(renderOption)}
      </div>
      <div className='mt-1 space-y-1'>
        {
          files.map(file => (
            <FileItem
              key={file.id}
              file={file}
              showDeleteAction
              showDownloadAction={false}
              onRemove={() => handleRemoveFile(file.id)}
              onReUpload={() => handleReUploadFile(file.id)}
            />
          ))
        }
      </div>
    </div>
  )
}

type FileUploaderInAttachmentWrapperProps = {
  value?: FileEntity[]
  onChange: (files: FileEntity[]) => void
  fileConfig: FileUpload
}
const FileUploaderInAttachmentWrapper = ({
  value,
  onChange,
  fileConfig,
}: FileUploaderInAttachmentWrapperProps) => {
  return (
    <FileContextProvider
      value={value}
      onChange={onChange}
    >
      <FileUploaderInAttachment fileConfig={fileConfig} />
    </FileContextProvider>
  )
}

export default FileUploaderInAttachmentWrapper
