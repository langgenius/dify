'use client'

import type { KnowledgeFsSpaceListItemResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { TagResponse as Tag } from '@dify/contracts/api/console/tags/types.gen'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { TagSelector } from '@/features/tag-management/components/tag-selector'
import { consoleQuery } from '@/service/console'

export function KnowledgeSpaceCardTags({
  knowledgeSpace,
  onOpenTagManagement,
}: {
  knowledgeSpace: KnowledgeFsSpaceListItemResponse
  onOpenTagManagement: () => void
}) {
  const { t } = useTranslation(['common'])
  const queryClient = useQueryClient()
  const canEdit = knowledgeSpace.permission_keys.includes('knowledge_space_edit')
  // The latest submitted selection stays authoritative until every queued replacement and the
  // follow-up cache sync finish, so reopening the picker never starts from stale server tags.
  const [submittedTagIds, setSubmittedTagIds] = useState<string[]>()
  const replacementQueueRef = useRef<{ next?: string[]; running: boolean }>({ running: false })
  const tags = useMemo<Tag[]>(() => {
    const providedTags = knowledgeSpace.tags ?? []
    // TagSelector resolves names from the tag list; provided names are only a fallback.
    const knowledgeTags =
      submittedTagIds?.map((id) => ({
        id,
        name: providedTags.find((tag) => tag.id === id)?.name ?? '',
      })) ?? providedTags
    return knowledgeTags.map((tag) => ({
      binding_count: '',
      id: tag.id,
      name: tag.name,
      type: 'knowledge',
    }))
  }, [knowledgeSpace.tags, submittedTagIds])
  const { mutateAsync: replaceTags } = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.tags.put.mutationOptions(),
  )

  const runReplacements = async (tagIds: string[]) => {
    const queue = replacementQueueRef.current
    queue.running = true
    let nextTagIds: string[] | undefined = tagIds
    let succeeded = false
    while (nextTagIds) {
      const currentTagIds: string[] = nextTagIds
      queue.next = undefined
      try {
        await replaceTags({
          params: { control_space_id: knowledgeSpace.control_space_id },
          body: { tag_ids: currentTagIds },
        })
        succeeded = true
      } catch {
        succeeded = false
        toast.error(t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }))
      }
      nextTagIds = queue.next
    }
    if (succeeded) toast.success(t(($) => $['actionMsg.modifiedSuccessfully'], { ns: 'common' }))
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: consoleQuery.knowledgeFs.spaces.get.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: consoleQuery.tags.get.key({
          type: 'query',
          input: { query: { type: 'knowledge' } },
        }),
      }),
    ]).catch(() => undefined)
    // A selection submitted during the cache sync starts its own replacement run.
    if (queue.next) {
      void runReplacements(queue.next)
      return
    }
    queue.running = false
    setSubmittedTagIds(undefined)
  }

  const applyTags = (tagIds: string[]) => {
    setSubmittedTagIds(tagIds)
    const queue = replacementQueueRef.current
    if (queue.running) {
      queue.next = tagIds
      return
    }
    void runReplacements(tagIds)
  }

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
      onApplyTags={applyTags}
      className="relative z-1 mx-3 w-auto"
    />
  )
}
