import {
  memo,
  useCallback,
} from 'react'
import {
  RiLink,
  RiUploadCloud2Line,
} from '@remixicon/react'
import FileFromLinkOrLocal from '../file-from-link-or-local'
import FileInAttachmentItem from './file-in-attachment-item'
import Button from '@/app/components/base/button'
import cn from '@/utils/classnames'

type Option = {
  value: string
  label: string
  icon: JSX.Element
}
const FileUploaderInAttachment = () => {
  const options = [
    {
      value: 'local',
      label: 'Local upload',
      icon: <RiUploadCloud2Line className='w-4 h-4' />,
    },
    {
      value: 'link',
      label: 'Paste file link',
      icon: <RiLink className='w-4 h-4' />,
    },
  ]

  const renderButton = useCallback((option: Option, open?: boolean) => {
    return (
      <Button
        key={option.value}
        variant='tertiary'
        className={cn('grow', open && 'bg-components-button-tertiary-bg-hover')}
      >
        {option.icon}
        <span className='ml-1'>{option.label}</span>
      </Button>
    )
  }, [])
  const renderTrigger = useCallback((option: Option) => {
    return (open: boolean) => renderButton(option, open)
  }, [renderButton])
  const renderOption = useCallback((option: Option) => {
    if (option.value === 'local')
      return renderButton(option)

    if (option.value === 'link') {
      return (
        <FileFromLinkOrLocal
          showFromLocal={false}
          trigger={renderTrigger(option)}
        />
      )
    }
  }, [renderButton, renderTrigger])

  return (
    <div>
      <div className='flex items-center space-x-1'>
        {options.map(renderOption)}
      </div>
      <div className='mt-1 space-y-1'>
        <FileInAttachmentItem />
        <FileInAttachmentItem />
      </div>
    </div>
  )
}

export default memo(FileUploaderInAttachment)
