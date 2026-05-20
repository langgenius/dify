'use client'
import type { FC } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTheme } from 'next-themes'
import * as React from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import { getMarketplace } from '@/service/base'
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

  const downloadInfo = useMemo(() => ({
    organization: author,
    pluginName: name,
    version,
  }), [author, name, version])

  const downloadMutation = useMutation({
    mutationFn: () => getMarketplace<Blob>(`/plugins/${downloadInfo.organization}/${downloadInfo.pluginName}/${downloadInfo.version}/download`),
    onSuccess: (blob) => {
      downloadBlob({ data: blob, fileName: `${author}-${name}_${version}.zip` })
      queryClient.removeQueries({
        queryKey: ['plugins', 'downloadPlugin', downloadInfo],
        exact: true,
      })
    },
  })

  const handleDownload = () => {
    if (downloadMutation.isPending)
      return

    onOpenChange(false)
    queryClient.removeQueries({
      queryKey: ['plugins', 'downloadPlugin', downloadInfo],
      exact: true,
    })
    downloadMutation.mutate()
  }

  return (
    <DropdownMenu
      open={open}
      onOpenChange={onOpenChange}
    >
      <DropdownMenuTrigger
        render={(
          <ActionButton
            className="focus-visible:ring-2 focus-visible:ring-state-accent-solid data-popup-open:bg-state-base-hover"
            aria-label={t('operation.more', { ns: 'common' })}
          >
            <span aria-hidden className="i-ri-more-fill size-4 text-components-button-secondary-accent-text" />
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
