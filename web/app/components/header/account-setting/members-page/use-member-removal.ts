import type { AccountWithRoleResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { RefObject, SubmitEventHandler } from 'react'
import { createAlertDialogHandle } from '@langgenius/dify-ui/alert-dialog'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { consoleQuery } from '@/service/console'

export const keepPlatformContactField = 'keep_as_platform_contact'

type MemberRemovalPayload = {
  member: AccountWithRoleResponse
  adjacentFocusTargets: HTMLElement[]
  fallbackFocus: { current: HTMLElement | null }
}

export function useMemberRemoval(listRef: RefObject<HTMLElement | null>) {
  const [dialog] = useState(() => createAlertDialogHandle<MemberRemovalPayload>())
  const { isPending, isError, mutate, reset } = useMutation(
    consoleQuery.workspaces.current.members.byMemberId.delete.mutationOptions({
      meta: { errorToast: false },
    }),
  )

  const getSubmitHandler =
    (payload: MemberRemovalPayload | undefined): SubmitEventHandler<HTMLFormElement> =>
    (event) => {
      event.preventDefault()
      if (!payload || isPending) return
      const keepPlatformContact = new FormData(event.currentTarget).has(keepPlatformContactField)
      mutate(
        {
          params: { member_id: payload.member.id },
          ...(keepPlatformContact && { query: { keep_as_platform_contact: true } }),
        },
        {
          onSuccess: () => {
            payload.fallbackFocus.current = listRef.current
            dialog.close()
          },
        },
      )
    }

  return { dialog, isPending, isError, reset, getSubmitHandler }
}
