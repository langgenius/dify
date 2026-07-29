'use client'

import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useTranslation } from 'react-i18next'

export function DocumentActionsDropdown({
  className,
  documentTitle,
  onReindex,
  showReindex = true,
}: {
  className?: string
  documentTitle: string
  onReindex?: () => void
  showReindex?: boolean
}) {
  const { t } = useTranslation('dataset')
  if (!showReindex || !onReindex) return null

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        aria-label={t(($) => $['newKnowledge.documentActions'], { name: documentTitle })}
        className={cn(
          'ml-auto flex size-7 items-center justify-end rounded-md text-text-tertiary outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid',
          className,
        )}
      >
        <span aria-hidden className="i-ri-more-fill size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent placement="bottom-end" sideOffset={4} popupClassName="w-[200px]">
        <DropdownMenuItem className="gap-2 px-3" onClick={onReindex}>
          <span aria-hidden className="i-ri-loop-left-line size-4" />
          {t(($) => $['newKnowledge.reindexDocument'])}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
