import type { FC } from 'react'
import type {
  CursorPosition,
  OnlineUser,
} from '@/app/components/workflow/collaboration/types/collaboration'
import { useViewport } from 'reactflow'
import { getUserColor } from '../utils/user-color'
import { CollaboratorCursor } from './collaborator-cursor'

type UserCursorsProps = {
  cursors: Record<string, CursorPosition>
  myUserId: string | null
  onlineUsers: OnlineUser[]
}

const UserCursors: FC<UserCursorsProps> = ({ cursors, myUserId, onlineUsers }) => {
  const viewport = useViewport()

  const convertToScreenCoordinates = (cursor: CursorPosition) => {
    // Convert world coordinates to screen coordinates using current viewport
    const screenX = cursor.x * viewport.zoom + viewport.x
    const screenY = cursor.y * viewport.zoom + viewport.y

    return { x: screenX, y: screenY }
  }
  return (
    <>
      {Object.entries(cursors || {}).map(([userId, cursor]) => {
        if (userId === myUserId) return null

        const userInfo = onlineUsers.find((user) => user.user_id === userId)
        const userName = userInfo?.username || `User ${userId.slice(-4)}`
        const userColor = getUserColor(userId)
        const screenPos = convertToScreenCoordinates(cursor)

        return (
          <CollaboratorCursor
            key={userId}
            name={userName}
            color={userColor}
            className="absolute z-8 transition-all duration-150 ease-out"
            style={{ left: screenPos.x, top: screenPos.y }}
          />
        )
      })}
    </>
  )
}

export default UserCursors
