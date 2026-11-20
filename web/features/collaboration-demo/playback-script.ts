import type { DemoNodeId } from './demo-graph'
import type { DemoUserId } from './demo-users'

type Point = { x: number; y: number }
type Waypoint = readonly [seconds: number, x: number, y: number]

export const demoCommentPosition: Point = { x: 850, y: 370 }

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
  [0, 1150, 640],
  [1, demoCommentPosition.x, demoCommentPosition.y],
  [4.6, demoCommentPosition.x, demoCommentPosition.y],
  [5.6, 760, 640],
  [14.2, 760, 640],
  [14.8, 990, 625],
  [17.8, 990, 625],
  [18.6, 1180, 520],
]

const samPath: Waypoint[] = [
  [0, 1250, 120],
  [4.8, 1250, 120],
  [5.6, 470, 300],
  [7.4, 470, 300],
  [8.2, 790, 480],
  [9.8, 790, 480],
  [10.4, 980, 625],
  [14, 980, 625],
  [14.8, 1220, 260],
]

const presence: { node: DemoNodeId; from: number; to: number }[] = [
  { node: 'checkOrder', from: 5.6, to: 7.4 },
  { node: 'generateReply', from: 8.2, to: 9.8 },
]

const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2)

function pointAt(path: Waypoint[], seconds: number, reducedMotion: boolean): Point {
  const next = path.findIndex(([at]) => at > seconds)
  if (next === -1) {
    const [, x, y] = path[path.length - 1]!
    return { x, y }
  }
  if (next === 0) return { x: path[0]![1], y: path[0]![2] }
  const [t0, x0, y0] = path[next - 1]!
  const [t1, x1, y1] = path[next]!
  if (reducedMotion) return { x: x1, y: y1 }
  const p = easeInOut((seconds - t0) / (t1 - t0))
  return { x: x0 + (x1 - x0) * p, y: y0 + (y1 - y0) * p }
}

export function getPlaybackFrame(seconds: number, reducedMotion = false) {
  const visibleMessages = demoMessages.filter(({ at }) => seconds >= at).length
  const typing = demoMessages.find(({ typing: [from], at }) => seconds >= from && seconds < at)
  const lastAuthor = demoMessages[Math.max(0, visibleMessages - 1)]!.author

  return {
    alex: pointAt(alexPath, seconds, reducedMotion),
    sam: pointAt(samPath, seconds, reducedMotion),
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
