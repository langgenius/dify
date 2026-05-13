'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useQueryClient } from '@tanstack/react-query'
import { useTheme } from 'next-themes'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import { useDownloadPlugin } from '@/service/use-plugins'
import { downloadBlob } from '@/utils/download'
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
  const setOpen = useCallback((value: boolean) => {
    onOpenChange(value)
  }, [onOpenChange])

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
    setOpen(false)
    queryClient.removeQueries({
      queryKey: ['plugins', 'downloadPlugin', downloadInfo],
      exact: true,
    })
    setNeedDownload(true)
  }, [downloadInfo, isLoading, queryClient, setOpen])

  useEffect(() => {
    if (!needDownload || !blob)
      return
    const fileName = `${author}-${name}_${version}.zip`
    downloadBlob({ data: blob, fileName })
    setNeedDownload(false)
    queryClient.removeQueries({
      queryKey: ['plugins', 'downloadPlugin', downloadInfo],
      exact: true,
    })
  }, [author, blob, downloadInfo, name, needDownload, queryClient, version])
  return (
    <DropdownMenu
      open={open}
      onOpenChange={setOpen}
    >
      <DropdownMenuTrigger
        render={(
          <ActionButton
            className={cn(open && 'bg-state-base-hover', 'focus-visible:ring-2 focus-visible:ring-state-accent-solid')}
            aria-label={t('operation.more', { ns: 'common' })}
          >
            <span aria-hidden className="i-ri-more-fill h-4 w-4 text-components-button-secondary-accent-text" />
          </ActionButton>
        )}
      />
      <DropdownMenuContent
        placement="bottom-end"
        sideOffset={4}
        popupClassName="min-w-[176px]"
      >
        <DropdownMenuItem className="system-md-regular" onClick={handleDownload}>
          {t('operation.download', { ns: 'common' })}
        </DropdownMenuItem>
        <DropdownMenuLinkItem
          className="system-md-regular"
          href={getMarketplaceUrl(`/plugins/${author}/${name}`, { theme })}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t('operation.viewDetails', { ns: 'common' })}
        </DropdownMenuLinkItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
export default React.memo(OperationDropdown)
