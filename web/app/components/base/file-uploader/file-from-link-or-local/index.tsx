import {
  memo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { RiUploadCloud2Line } from '@remixicon/react'
import FileInput from '../file-input'
import { useFile } from '../hooks'
import { useStore } from '../store'
import { FILE_URL_REGEX } from '../constants'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import Button from '@/app/components/base/button'
import type { FileUpload } from '@/app/components/base/features/types'
import cn from '@/utils/classnames'

type FileFromLinkOrLocalProps = {
  showFromLink?: boolean
  showFromLocal?: boolean
  trigger: (open: boolean) => React.ReactNode
  fileConfig: FileUpload
}
const FileFromLinkOrLocal = ({
  showFromLink = true,
  showFromLocal = true,
  trigger,
  fileConfig,
}: FileFromLinkOrLocalProps) => {
  const { t } = useTranslation()
  const files = useStore(s => s.files)
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [showError, setShowError] = useState(false)
  const { handleLoadFileFromLink } = useFile(fileConfig)
  const disabled = !!fileConfig.number_limits && files.length >= fileConfig.number_limits

  const handleSaveUrl = () => {
    if (!url)
      return

    if (!FILE_URL_REGEX.test(url)) {
      setShowError(true)
      return
    }
    handleLoadFileFromLink(url)
    setUrl('')
  }

  return (
    <PortalToFollowElem
      placement='top'
      offset={4}
      open={open}
      onOpenChange={setOpen}
    >
      <PortalToFollowElemTrigger onClick={() => setOpen(v => !v)} asChild>
        {trigger(open)}
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-10'>
        <div className='p-3 w-[280px] bg-components-panel-bg-blur border-[0.5px] border-components-panel-border rounded-xl shadow-lg'>
          {
            showFromLink && (
              <>
                <div className={cn(
                  'flex items-center p-1 h-8 bg-components-input-bg-active border border-components-input-border-active rounded-lg shadow-xs',
                  showError && 'border-components-input-border-destructive',
                )}>
                  <input
                    className='grow block mr-0.5 px-1 bg-transparent system-sm-regular outline-none appearance-none'
                    placeholder={t('common.fileUploader.pasteFileLinkInputPlaceholder') || ''}
                    value={url}
                    onChange={(e) => {
                      setShowError(false)
                      setUrl(e.target.value)
                    }}
                    disabled={disabled}
                  />
                  <Button
                    className='shrink-0'
                    size='small'
                    variant='primary'
                    disabled={!url || disabled}
                    onClick={handleSaveUrl}
                  >
                    {t('common.operation.ok')}
                  </Button>
                </div>
                {
                  showError && (
                    <div className='mt-0.5 body-xs-regular text-text-destructive'>
                      {t('common.fileUploader.pasteFileLinkInvalid')}
                    </div>
                  )
                }
              </>
            )
          }
          {
            showFromLink && showFromLocal && (
              <div className='flex items-center p-2 h-7 system-2xs-medium-uppercase text-text-quaternary'>
                <div className='mr-2 w-[93px] h-[1px] bg-gradient-to-l from-[rgba(16,24,40,0.08)]' />
                OR
                <div className='ml-2 w-[93px] h-[1px] bg-gradient-to-r from-[rgba(16,24,40,0.08)]' />
              </div>
            )
          }
          {
            showFromLocal && (
              <Button
                className='relative w-full'
                variant='secondary-accent'
                disabled={disabled}
              >
                <RiUploadCloud2Line className='mr-1 w-4 h-4' />
                {t('common.fileUploader.uploadFromComputer')}
                <FileInput fileConfig={fileConfig} />
              </Button>
            )
          }
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default memo(FileFromLinkOrLocal)
