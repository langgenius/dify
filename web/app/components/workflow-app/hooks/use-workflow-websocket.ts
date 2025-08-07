import { useEffect, useState } from 'react'
import { useCollaboration } from '@/app/components/workflow/collaboration'

export function useCollaborativeCursors(appId: string) {
  const { cursors, isConnected } = useCollaboration(appId)
  const [myUserId, setMyUserId] = useState<string | null>(null)

  useEffect(() => {
    if (isConnected)
      setMyUserId('current-user')
  }, [isConnected])

  const filteredCursors = Object.fromEntries(
    Object.entries(cursors).filter(([userId]) => userId !== myUserId),
  )

  return { cursors: filteredCursors, myUserId }
}
