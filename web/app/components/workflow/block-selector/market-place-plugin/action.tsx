'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTheme } from 'next-themes'
import { useTranslation } from 'react-i18next'
import { RiMoreFill } from '@remixicon/react'
import ActionButton from '@/app/components/base/action-button'
// import Button from '@/app/components/base/button'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import cn from '@/utils/classnames'
import { useDownloadPlugin } from '@/service/use-plugins'
import { downloadFile } from '@/utils/format'
import { getMarketplaceUrl } from '@/utils/var'

type Props = {
  open: boolean
  onOpenChange: (v: boolean) => void
  author: string
  name: string
  version: string
}

const OperationDropdown: FC<Props> = ({
  open,
  onOpenChange,
  author,
  name,
  version,
}) => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const openRef = useRef(open)
  const setOpen = useCallback((v: boolean) => {
    onOpenChange(v)
    openRef.current = v
  }, [onOpenChange])

  const handleTrigger = useCallback(() => {
    setOpen(!openRef.current)
  }, [setOpen])

  const [needDownload, setNeedDownload] = useState(false)
  const { data: blob, isLoading } = useDownloadPlugin({
    organization: author,
    pluginName: name,
    version,
  }, needDownload)
  const handleDownload = useCallback(() => {
    if (isLoading) return
    setNeedDownload(true)
  }, [isLoading])

  useEffect(() => {
    if (blob) {
      const fileName = `${author}-${name}_${version}.zip`
      downloadFile({ data: blob, fileName })
      setNeedDownload(false)
    }
  }, [blob])
  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-end'
      offset={{
        mainAxis: 0,
        crossAxis: 0,
      }}
    >
      <PortalToFollowElemTrigger onClick={handleTrigger}>
        <ActionButton className={cn(open && 'bg-state-base-hover')}>
          <RiMoreFill className='h-4 w-4 text-components-button-secondary-accent-text' />
        </ActionButton>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-[9999]'>
        <div className='w-[112px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg'>
          <div onClick={handleDownload} className='system-md-regular cursor-pointer rounded-lg px-3 py-1.5 text-text-secondary hover:bg-state-base-hover'>{t('common.operation.download')}</div>
          <a href={getMarketplaceUrl(`/plugins/${author}/${name}`, { theme })} target='_blank' className='system-md-regular block cursor-pointer rounded-lg px-3 py-1.5 text-text-secondary hover:bg-state-base-hover'>{t('common.operation.viewDetails')}</a>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}
export default React.memo(OperationDropdown)
