import type { DemoNodeId } from './demo-graph'
import type { DemoUserId } from './demo-users'

type Point = { x: number; y: number }
export type CursorAnchor = Point | 'reply'
type Waypoint = readonly [seconds: number, anchor: CursorAnchor]

export const demoCommentPosition: Point = { x: 1280, y: 300 }

export const demoMessages: readonly {
  id: 'alexAsk' | 'samReply' | 'alexConfirm'
  author: DemoUserId
  mention?: DemoUserId
  typing: readonly [from: number, to: number]
  at: number
}[] = [
  { id: 'alexAsk', author: 'alex', mention: 'sam', typing: [1.4, 4.2], at: 4.6 },
  { id: 'samReply', author: 'sam', mention: 'alex', typing: [10.6, 13.4], at: 13.8 },
  { id: 'alexConfirm', author: 'alex', typing: [14.8, 17.2], at: 17.6 },
]

export const demoDuration = 19.5

const markerPlacedAt = 1

const alexPath: Waypoint[] = [
  [0, { x: 1100, y: 600 }],
  [1, demoCommentPosition],
  [4.6, demoCommentPosition],
  [5.6, { x: 1060, y: 590 }],
  [14.2, { x: 1060, y: 590 }],
  [14.8, 'reply'],
  [17.8, 'reply'],
  [18.6, { x: 860, y: 620 }],
]

const samPath: Waypoint[] = [
  [0, { x: 1180, y: 110 }],
  [4.8, { x: 1180, y: 110 }],
  [5.6, { x: 470, y: 300 }],
  [7.4, { x: 470, y: 300 }],
  [8.2, { x: 790, y: 480 }],
  [9.8, { x: 790, y: 480 }],
  [10.4, 'reply'],
  [14, 'reply'],
  [14.8, { x: 520, y: 580 }],
]

const presence: { node: DemoNodeId; from: number; to: number }[] = [
  { node: 'checkOrder', from: 5.6, to: 7.4 },
  { node: 'generateReply', from: 8.2, to: 9.8 },
]

const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2)

function cursorAt(path: Waypoint[], seconds: number, reducedMotion: boolean) {
  const next = path.findIndex(([at]) => at > seconds)
  if (next <= 0) {
    const [, anchor] = path[next === 0 ? 0 : path.length - 1]!
    return { from: anchor, to: anchor, progress: 1 }
  }
  const [t0, from] = path[next - 1]!
  const [t1, to] = path[next]!
  return {
    from,
    to,
    progress: reducedMotion ? 1 : easeInOut((seconds - t0) / (t1 - t0)),
  }
}

export function getPlaybackFrame(seconds: number, reducedMotion = false) {
  const visibleMessages = demoMessages.filter(({ at }) => seconds >= at).length
  const typing = demoMessages.find(({ typing: [from], at }) => seconds >= from && seconds < at)
  const lastAuthor = demoMessages[Math.max(0, visibleMessages - 1)]!.author

  return {
    alex: cursorAt(alexPath, seconds, reducedMotion),
    sam: cursorAt(samPath, seconds, reducedMotion),
    marker:
      seconds < markerPlacedAt
        ? undefined
        : visibleMessages === 0
          ? ('composing' as const)
          : ('thread' as const),
    draft: typing && {
      message: typing.id,
      author: typing.author,
      progress: Math.min(1, (seconds - typing.typing[0]) / (typing.typing[1] - typing.typing[0])),
    },
    replyAuthor: typing?.author ?? lastAuthor,
    visibleMessages,
    samViewing: presence.find(({ from, to }) => seconds >= from && seconds < to)?.node,
  }
}

export type PlaybackFrame = ReturnType<typeof getPlaybackFrame>
