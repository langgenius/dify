import React from 'react'
import { useCollaboration } from '../hooks/use-collaboration'

type LeaderTestProps = {
  appId: string
}

export function LeaderTest({ appId }: LeaderTestProps) {
  const { isConnected, isLeader, leaderId, onlineUsers } = useCollaboration(appId)

  return (
    <div className="rounded-lg border bg-gray-50 p-4">
      <h3 className="mb-4 text-lg font-semibold">Leader Election Test</h3>

      <div className="space-y-2">
        <div className="flex items-center space-x-2">
          <span className="font-medium">Connection:</span>
          <span className={`rounded px-2 py-1 text-sm ${
            isConnected ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
          }`}>
            {isConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>

        <div className="flex items-center space-x-2">
          <span className="font-medium">I am Leader:</span>
          <span className={`rounded px-2 py-1 text-sm ${
            isLeader ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'
          }`}>
            {isLeader ? 'YES' : 'NO'}
          </span>
        </div>

        <div className="flex items-center space-x-2">
          <span className="font-medium">Current Leader ID:</span>
          <span className="rounded bg-gray-100 px-2 py-1 font-mono text-sm">
            {leaderId || 'None'}
          </span>
        </div>

        <div className="mt-4">
          <span className="font-medium">Online Users ({onlineUsers.length}):</span>
          <div className="mt-2 space-y-1">
            {onlineUsers.map((user: any) => (
              <div key={user.user_id} className="flex items-center space-x-2 text-sm">
                <span className={`h-2 w-2 rounded-full ${
                  user.user_id === leaderId ? 'bg-blue-500' : 'bg-green-500'
                }`} />
                <span className="font-mono">{user.user_id}</span>
                <span>({user.username})</span>
                {user.user_id === leaderId && (
                  <span className="font-medium text-blue-600">👑 Leader</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
