'use client'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useMutation } from '@tanstack/react-query'
import { useTheme } from 'next-themes'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { marketplaceQuery } from '@/service/client'
import { downloadBlob } from '@/utils/download'
import { getMarketplaceUrl } from '@/utils/var'

type Props = Readonly<{
  open: boolean
  onOpenChange: (v: boolean) => void
  author: string
  name: string
  version: string
}>

function OperationDropdown({ open, onOpenChange, author, name, version }: Props) {
  const { t } = useTranslation()
  const { theme } = useTheme()

  const downloadMutation = useMutation(
    marketplaceQuery.downloadPlugin.mutationOptions({
      onSuccess: (blob) => {
        downloadBlob({ data: blob, fileName: `${author}-${name}_${version}.zip` })
      },
    }),
  )

  const handleDownload = () => {
    if (downloadMutation.isPending) return

    onOpenChange(false)
    downloadMutation.mutate({
      params: {
        organization: author,
        pluginName: name,
        version,
      },
    })
  }

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        render={
          <IconButton
            variant="ghost"
            size="md"
            className="rounded-lg focus-visible:ring-inset data-popup-open:bg-state-base-hover"
            aria-label={t(($) => $['operation.more'], { ns: 'common' })}
          >
            <span
              aria-hidden
              className="i-ri-more-fill size-4 text-components-button-secondary-accent-text"
            />
          </IconButton>
        }
      />
      <DropdownMenuContent placement="bottom-end" sideOffset={4} className="min-w-[176px]">
        <DropdownMenuItem className="system-md-regular" onClick={handleDownload}>
          {t(($) => $['operation.download'], { ns: 'common' })}
        </DropdownMenuItem>
        <DropdownMenuLinkItem
          className="system-md-regular"
          href={getMarketplaceUrl(`/plugins/${author}/${name}`, { theme })}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t(($) => $['operation.viewDetails'], { ns: 'common' })}
        </DropdownMenuLinkItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default memo(OperationDropdown)
