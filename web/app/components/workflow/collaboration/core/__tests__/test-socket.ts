import type { CollaborationUpdate, GraphUpdateMetadata } from '../../types/collaboration'
import { Manager } from 'socket.io-client'

export type GraphPacket = GraphUpdateMetadata & { data: Uint8Array }

const isGraphPacket = (value: unknown): value is GraphPacket =>
  !!value &&
  typeof value === 'object' &&
  'data' in value &&
  value.data instanceof Uint8Array &&
  'historyId' in value &&
  typeof value.historyId === 'string'

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
    const packet = args[0]
    for (const listener of socket.listeners(event)) {
      if (event === 'graph_update' && isGraphPacket(packet)) {
        const { data, ...metadata } = packet
        listener(data, metadata)
      } else listener(...args)
    }
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
    if (typeof callback !== 'function')
      throw new TypeError(`No acknowledgement callback for ${event}`)
    callback(body, status)
  }
  const snapshot = (requester?: { messages: typeof messages }) => {
    const request = requester?.messages('graph_resync_request').at(-1)?.[1].data
    const before = emit.mock.calls.length
    update('graph_resync_request', request ?? {})
    const packet = emit.mock.calls.slice(before).find(([event]) => event === 'graph_event')?.[1]
    if (!isGraphPacket(packet)) throw new Error('No graph snapshot was broadcast')
    return packet
  }
  return { socket, emit, receive, update, messages, acknowledge, snapshot }
}
