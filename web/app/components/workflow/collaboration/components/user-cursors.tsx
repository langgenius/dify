import type { FC } from 'react'
import type { CursorPosition, OnlineUser } from '@/app/components/workflow/collaboration/types'

type UserCursorsProps = {
  cursors: Record<string, CursorPosition>
  myUserId: string | null
  onlineUsers: OnlineUser[]
}

const getUserColor = (id: string) => {
  const colors = ['#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16']
  const hash = id.split('').reduce((a, b) => {
    a = ((a << 5) - a) + b.charCodeAt(0)
    return a & a
  }, 0)
  return colors[Math.abs(hash) % colors.length]
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
            className="pointer-events-none absolute z-[10000] -translate-x-0.5 -translate-y-0.5 transition-all duration-150 ease-out"
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
                d="M3 3L16 8L9 10L7 17L3 3Z"
                fill={userColor}
                stroke="white"
                strokeWidth="1"
                strokeLinejoin="round"
              />
            </svg>

            <div
              className="absolute -top-0.5 left-[18px] max-w-[120px] overflow-hidden text-ellipsis whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium text-white shadow-sm"
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
