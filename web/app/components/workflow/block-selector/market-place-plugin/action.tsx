'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useRef, useState } from 'react'
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
import { MARKETPLACE_URL_PREFIX } from '@/config'
import { useDownloadPlugin } from '@/service/use-plugins'
import { downloadFile } from '@/utils/format'

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          <RiMoreFill className='text-components-button-secondary-accent-text h-4 w-4' />
        </ActionButton>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-[9999]'>
        <div className='bg-components-panel-bg-blur border-components-panel-border w-[112px] rounded-xl border-[0.5px] p-1 shadow-lg'>
          <div onClick={handleDownload} className='text-text-secondary system-md-regular hover:bg-state-base-hover cursor-pointer rounded-lg px-3 py-1.5'>{t('common.operation.download')}</div>
          <a href={`${MARKETPLACE_URL_PREFIX}/plugins/${author}/${name}`} target='_blank' className='text-text-secondary system-md-regular hover:bg-state-base-hover block cursor-pointer rounded-lg px-3 py-1.5'>{t('common.operation.viewDetails')}</a>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}
export default React.memo(OperationDropdown)
