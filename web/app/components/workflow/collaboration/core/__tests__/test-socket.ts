import type { CollaborationUpdate } from '../../types/collaboration'
import { Manager } from 'socket.io-client'

// Keep Socket's public listener contract, but never open a transport.
export const createSocket = (id: string, connected = true) => {
  const socket = new Manager('http://localhost', {
    autoConnect: false,
    reconnection: false,
  }).socket('/')
  socket.id = id
  socket.connected = connected
  const emit = vi.spyOn(socket, 'emit').mockReturnValue(socket)
  const receive = (event: string, ...args: unknown[]) => {
    if (event === 'connect') socket.connected = true
    if (event === 'disconnect') socket.connected = false
    for (const listener of socket.listeners(event)) listener(...args)
  }
  const update = (
    type: CollaborationUpdate['type'],
    data: CollaborationUpdate['data'],
    acknowledge?: (result: unknown) => void,
  ) => {
    receive(
      'collaboration_update',
      { type, data, userId: 'user-1', timestamp: 1000 } satisfies CollaborationUpdate,
      acknowledge,
    )
  }
  const messages = (type: CollaborationUpdate['type']) =>
    emit.mock.calls.filter(
      ([event, payload]) => event === 'collaboration_event' && payload?.type === type,
    )
  const acknowledge = (event: string, body: unknown, status?: number) => {
    const call =
      event === 'user_connect'
        ? emit.mock.calls.filter(([name]) => name === event).at(-1)
        : emit.mock.calls
            .filter(([name, payload]) => name === 'collaboration_event' && payload?.type === event)
            .at(-1)
    const callback = call?.[2]
    if (typeof callback !== 'function') throw new Error(`No acknowledgement callback for ${event}`)
    callback(body, status)
  }
  const snapshot = () => {
    update('graph_resync_request', {})
    const data = emit.mock.calls.filter(([event]) => event === 'graph_event').at(-1)?.[1]
    if (!(data instanceof Uint8Array)) throw new Error('No graph snapshot was broadcast')
    return data
  }
  return { socket, emit, receive, update, messages, acknowledge, snapshot }
}
