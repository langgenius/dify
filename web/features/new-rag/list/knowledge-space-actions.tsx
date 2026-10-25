'use client'

import type { KnowledgeFsSpaceListItemResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useTranslation } from 'react-i18next'
import Link from '@/next/link'
import { newKnowledgeSettingsPath } from '../routes'

export function KnowledgeSpaceActions({
  knowledgeSpace,
  onDelete,
}: {
  knowledgeSpace: KnowledgeFsSpaceListItemResponse
  onDelete: () => void
}) {
  const { t: tCommon } = useTranslation(['common'])
  const canEdit = knowledgeSpace.permission_keys.includes('knowledge_space_edit')
  const canDelete = knowledgeSpace.permission_keys.includes('knowledge_space_delete')
  if (!canEdit && !canDelete) return null

  return (
    <div className="pointer-events-none absolute top-0 right-0 flex h-16 w-30 items-start justify-end bg-linear-65 from-components-card-bg-alt-transparent to-components-card-bg-alt to-75% p-2 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 has-data-popup-open:opacity-100 [@media(hover:none)]:opacity-100">
      <div className="pointer-events-auto flex items-center overflow-hidden rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-lg backdrop-blur-xs">
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger
            render={
              <IconButton
                aria-label={tCommon(($) => $['operation.more'])}
                size="lg"
                className="data-popup-open:bg-state-base-hover"
              >
                <span aria-hidden className="i-ri-more-fill size-4.5" />
              </IconButton>
            }
          />
          <DropdownMenuContent className="min-w-46.5">
            {canEdit && (
              <DropdownMenuLinkItem
                render={<Link href={newKnowledgeSettingsPath(knowledgeSpace.control_space_id)} />}
              >
                <span aria-hidden className="mr-1 i-ri-edit-line size-4 text-text-tertiary" />
                {tCommon(($) => $['operation.edit'])}
              </DropdownMenuLinkItem>
            )}
            {canDelete && (
              <>
                {canEdit && <DropdownMenuSeparator />}
                <DropdownMenuItem variant="destructive" onClick={onDelete}>
                  <span aria-hidden className="mr-1 i-ri-delete-bin-line size-4" />
                  {tCommon(($) => $['operation.delete'])}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
