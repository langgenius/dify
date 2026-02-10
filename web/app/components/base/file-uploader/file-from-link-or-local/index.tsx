import type { FileUpload } from '@/app/components/base/features/types'
import { RiUploadCloud2Line } from '@remixicon/react'
import {
  memo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { cn } from '@/utils/classnames'
import { FILE_URL_REGEX } from '../constants'
import FileInput from '../file-input'
import { useFile } from '../hooks'
import { useStore } from '../store'

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
      placement="top"
      offset={4}
      open={open}
      onOpenChange={setOpen}
    >
      <PortalToFollowElemTrigger onClick={() => setOpen(v => !v)} asChild>
        {trigger(open)}
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className="z-[1001]">
        <div className="w-[280px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-3 shadow-lg">
          {
            showFromLink && (
              <>
                <div className={cn(
                  'flex h-8 items-center rounded-lg border border-components-input-border-active bg-components-input-bg-active p-1 shadow-xs',
                  showError && 'border-components-input-border-destructive',
                )}
                >
                  <input
                    className="system-sm-regular mr-0.5 block grow appearance-none bg-transparent px-1 outline-none"
                    placeholder={t('fileUploader.pasteFileLinkInputPlaceholder', { ns: 'common' }) || ''}
                    value={url}
                    onChange={(e) => {
                      setShowError(false)
                      setUrl(e.target.value.trim())
                    }}
                    disabled={disabled}
                  />
                  <Button
                    className="shrink-0"
                    size="small"
                    variant="primary"
                    disabled={!url || disabled}
                    onClick={handleSaveUrl}
                  >
                    {t('operation.ok', { ns: 'common' })}
                  </Button>
                </div>
                {
                  showError && (
                    <div className="body-xs-regular mt-0.5 text-text-destructive">
                      {t('fileUploader.pasteFileLinkInvalid', { ns: 'common' })}
                    </div>
                  )
                }
              </>
            )
          }
          {
            showFromLink && showFromLocal && (
              <div className="system-2xs-medium-uppercase flex h-7 items-center p-2 text-text-quaternary">
                <div className="mr-2 h-px w-[93px] bg-gradient-to-l from-[rgba(16,24,40,0.08)]" />
                OR
                <div className="ml-2 h-px w-[93px] bg-gradient-to-r from-[rgba(16,24,40,0.08)]" />
              </div>
            )
          }
          {
            showFromLocal && (
              <Button
                className="relative w-full"
                variant="secondary-accent"
                disabled={disabled}
              >
                <RiUploadCloud2Line className="mr-1 h-4 w-4" />
                {t('fileUploader.uploadFromComputer', { ns: 'common' })}
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
