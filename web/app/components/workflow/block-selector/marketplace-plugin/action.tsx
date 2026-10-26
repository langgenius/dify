'use client'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Menu, MenuContent, MenuItem, MenuLinkItem, MenuTrigger } from '@langgenius/dify-ui/menu'
import { useMutation } from '@tanstack/react-query'
import { useTheme } from 'next-themes'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { marketplaceQuery } from '@/service/marketplace'
import { downloadBlob } from '@/utils/download'
import { getMarketplaceUrl } from '@/utils/var'

type Props = Readonly<{
  open: boolean
  onOpenChange: (v: boolean) => void
  author: string
  name: string
  version: string
}>

function OperationMenu({ open, onOpenChange, author, name, version }: Props) {
  const { t } = useTranslation(['common'])
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
    <Menu open={open} onOpenChange={onOpenChange}>
      <MenuTrigger
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
      <MenuContent align="end" className="min-w-44">
        <MenuItem className="system-md-regular" onClick={handleDownload}>
          {t(($) => $['operation.download'], { ns: 'common' })}
        </MenuItem>
        <MenuLinkItem
          className="system-md-regular"
          href={getMarketplaceUrl(`/plugins/${author}/${name}`, { theme })}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t(($) => $['operation.viewDetails'], { ns: 'common' })}
        </MenuLinkItem>
      </MenuContent>
    </Menu>
  )
}

export default memo(OperationMenu)
