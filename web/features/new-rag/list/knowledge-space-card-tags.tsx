'use client'

import type { KnowledgeFsSpaceListItemResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { TagResponse as Tag } from '@dify/contracts/api/console/tags/types.gen'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { TagSelector } from '@/features/tag-management/components/tag-selector'
import { consoleQuery } from '@/service/client'

export function KnowledgeSpaceCardTags({
  knowledgeSpace,
  onOpenTagManagement,
}: {
  knowledgeSpace: KnowledgeFsSpaceListItemResponse
  onOpenTagManagement: () => void
}) {
  const { t } = useTranslation('common')
  const queryClient = useQueryClient()
  const canEdit = knowledgeSpace.permission_keys.includes('knowledge_space_edit')
  const tags = useMemo<Tag[]>(
    () =>
      (knowledgeSpace.tags ?? []).map((tag) => ({
        binding_count: '',
        id: tag.id,
        name: tag.name,
        type: 'knowledge',
      })),
    [knowledgeSpace.tags],
  )
  const replaceTagsMutation = useMutation({
    ...consoleQuery.knowledgeFs.spaces.byControlSpaceId.tags.put.mutationOptions(),
    onError: () => toast.error(t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' })),
    onSuccess: () => toast.success(t(($) => $['actionMsg.modifiedSuccessfully'], { ns: 'common' })),
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: consoleQuery.knowledgeFs.spaces.get.key(),
      })
      void queryClient.invalidateQueries({
        queryKey: consoleQuery.tags.get.key({
          type: 'query',
          input: { query: { type: 'knowledge' } },
        }),
      })
    },
  })

  return (
    <TagSelector
      type="knowledge"
      targetId={knowledgeSpace.control_space_id}
      contextLabel={knowledgeSpace.technical_summary?.name ?? knowledgeSpace.control_space_id}
      value={tags}
      canBindOrUnbindTags={canEdit}
      requiresTargetEditPermission
      showProvidedTagNames
      onOpenTagManagement={onOpenTagManagement}
      onApplyTags={(tagIds) =>
        replaceTagsMutation.mutate({
          params: { control_space_id: knowledgeSpace.control_space_id },
          body: { tag_ids: tagIds },
        })
      }
      className="relative z-1 mx-3 w-auto"
    />
  )
}
