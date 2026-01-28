'use client'
import type { FC } from 'react'
import { RiMoreFill } from '@remixicon/react'
import { useQueryClient } from '@tanstack/react-query'
import { useTheme } from 'next-themes'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
// import Button from '@/app/components/base/button'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { useDownloadPlugin } from '@/service/use-plugins'
import { cn } from '@/utils/classnames'
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
  const queryClient = useQueryClient()
  const openRef = useRef(open)
  const setOpen = useCallback((v: boolean) => {
    onOpenChange(v)
    openRef.current = v
  }, [onOpenChange])

  const handleTrigger = useCallback(() => {
    setOpen(!openRef.current)
  }, [setOpen])

  const [needDownload, setNeedDownload] = useState(false)
  const downloadInfo = useMemo(() => ({
    organization: author,
    pluginName: name,
    version,
  }), [author, name, version])
  const { data: blob, isLoading } = useDownloadPlugin(downloadInfo, needDownload)
  const handleDownload = useCallback(() => {
    if (isLoading)
      return
    queryClient.removeQueries({
      queryKey: ['plugins', 'downloadPlugin', downloadInfo],
      exact: true,
    })
    setNeedDownload(true)
  }, [downloadInfo, isLoading, queryClient])

  useEffect(() => {
    if (!needDownload || !blob)
      return
    const fileName = `${author}-${name}_${version}.zip`
    downloadFile({ data: blob, fileName })
    setNeedDownload(false)
    queryClient.removeQueries({
      queryKey: ['plugins', 'downloadPlugin', downloadInfo],
      exact: true,
    })
  }, [author, blob, downloadInfo, name, needDownload, queryClient, version])
  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement="bottom-end"
      offset={{
        mainAxis: 0,
        crossAxis: 0,
      }}
    >
      <PortalToFollowElemTrigger onClick={handleTrigger}>
        <ActionButton className={cn(open && 'bg-state-base-hover')}>
          <RiMoreFill className="h-4 w-4 text-components-button-secondary-accent-text" />
        </ActionButton>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className="z-[9999]">
        <div className="min-w-[176px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg">
          <div onClick={handleDownload} className="system-md-regular cursor-pointer rounded-lg px-3 py-1.5 text-text-secondary hover:bg-state-base-hover">{t('operation.download', { ns: 'common' })}</div>
          <a href={getMarketplaceUrl(`/plugins/${author}/${name}`, { theme })} target="_blank" className="system-md-regular block cursor-pointer rounded-lg px-3 py-1.5 text-text-secondary hover:bg-state-base-hover">{t('operation.viewDetails', { ns: 'common' })}</a>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}
export default React.memo(OperationDropdown)
