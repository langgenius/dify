import type { DemoNodeId } from './demo-graph'

type Point = { x: number; y: number }
type Waypoint = readonly [seconds: number, x: number, y: number]

export const demoCommentPosition: Point = { x: 660, y: 380 }

export const demoMessages = [
  { id: 'alexAsk', author: 'alex', at: 1.2 },
  { id: 'samReply', author: 'sam', at: 7.8 },
  { id: 'alexConfirm', author: 'alex', at: 12.5 },
] as const

export const demoDuration = 17.5

const alexPath: Waypoint[] = [
  [0, 900, 640],
  [1, demoCommentPosition.x, demoCommentPosition.y],
  [3, demoCommentPosition.x, demoCommentPosition.y],
  [4, 520, 560],
  [11.4, 540, 570],
  [12.3, 880, 500],
]

const samPath: Waypoint[] = [
  [0, 1250, 330],
  [2, 1250, 330],
  [3, 500, 280],
  [4.6, 500, 280],
  [5.4, 840, 460],
  [7, 840, 460],
  [7.6, 960, 520],
]

const presence: { node: DemoNodeId; from: number; to: number }[] = [
  { node: 'checkOrder', from: 3, to: 4.6 },
  { node: 'generateReply', from: 5.4, to: 7 },
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
  return {
    alex: pointAt(alexPath, seconds, reducedMotion),
    sam: pointAt(samPath, seconds, reducedMotion),
    threadOpen: seconds >= 1,
    visibleMessages: demoMessages.filter(({ at }) => seconds >= at).length,
    samViewing: presence.find(({ from, to }) => seconds >= from && seconds < to)?.node,
  }
}
