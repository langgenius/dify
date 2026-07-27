'use client'

import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { toast } from '@langgenius/dify-ui/toast'
import { useTranslation } from 'react-i18next'

export function DocumentActionsDropdown({
  className,
  documentTitle,
  showReindex = true,
}: {
  className?: string
  documentTitle: string
  showReindex?: boolean
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const unavailable = () => toast.info(t(($) => $['newKnowledge.documentActionsUnavailable']))

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
        <DropdownMenuItem className="gap-2 px-3" onClick={unavailable}>
          <span aria-hidden className="i-ri-edit-line size-4" />
          {tCommon(($) => $['operation.rename'])}
        </DropdownMenuItem>
        {showReindex && (
          <DropdownMenuItem className="gap-2 px-3" onClick={unavailable}>
            <span aria-hidden className="i-ri-loop-left-line size-4" />
            {t(($) => $['newKnowledge.reindexDocument'])}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem className="gap-2 px-3" onClick={unavailable}>
          <span aria-hidden className="i-ri-indeterminate-circle-line size-4" />
          {t(($) => $['newKnowledge.disableSource'])}
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-2 px-3" onClick={unavailable}>
          <span aria-hidden className="i-ri-archive-2-line size-4" />
          {t(($) => $['batchAction.archive'])}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="gap-2 px-3" onClick={unavailable}>
          <span aria-hidden className="i-ri-download-line size-4" />
          {t(($) => $['newKnowledge.downloadDocuments'])}
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" className="gap-2 px-3" onClick={unavailable}>
          <span aria-hidden className="i-ri-delete-bin-line size-4" />
          {t(($) => $['newKnowledge.removeSource'])}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
