import type { FC } from 'react'
import type { CursorPosition, OnlineUser } from '@/app/components/workflow/collaboration/types'
import { getUserColor } from '../utils/user-color'

type UserCursorsProps = {
  cursors: Record<string, CursorPosition>
  myUserId: string | null
  onlineUsers: OnlineUser[]
}

const UserCursors: FC<UserCursorsProps> = ({
  cursors,
  myUserId,
  onlineUsers,
}) => {
  return (
    <>
      {Object.entries(cursors || {}).map(([userId, cursor]) => {
        if (userId === myUserId)
          return null

        const userInfo = onlineUsers.find(user => user.user_id === userId)
        const userName = userInfo?.username || `User ${userId.slice(-4)}`
        const userColor = getUserColor(userId)

        return (
          <div
            key={userId}
            className="pointer-events-none absolute z-[10000] transition-all duration-150 ease-out"
            style={{
              left: cursor.x,
              top: cursor.y,
            }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="drop-shadow-md"
            >
              <path
                d="M5 3L5 15L8 11.5L11 16L13 15L10 10.5L14 10.5L5 3Z"
                fill={userColor}
                stroke="white"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>

            <div
              className="absolute left-4 top-4 max-w-[120px] overflow-hidden text-ellipsis whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium text-white shadow-sm"
              style={{
                backgroundColor: userColor,
              }}
            >
              {userName}
            </div>
          </div>
        )
      })}
    </>
  )
}

export default UserCursors
