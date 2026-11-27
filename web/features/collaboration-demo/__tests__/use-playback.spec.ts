import { act, renderHook } from '@testing-library/react'
import { usePlayback } from '../use-playback'

let frames: FrameRequestCallback[]

beforeEach(() => {
  frames = []
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.push(callback)
    return frames.length
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  vi.spyOn(performance, 'now').mockReturnValue(0)
})

const nextFrame = (now: number) => act(() => frames.at(-1)!(now))

it('picks up where it was after a long gap between frames, such as a hidden tab', () => {
  const { result } = renderHook(() => usePlayback(10))

  nextFrame(15_000)

  expect(result.current.seconds).toBeCloseTo(0.1)
  expect(result.current.playing).toBe(true)
})

it('stops at the end and does not play again until restarted', () => {
  const { result } = renderHook(() => usePlayback(10))

  act(() => result.current.skip())
  act(() => result.current.play())
  expect(result.current).toMatchObject({ seconds: 10, playing: false, finished: true })

  act(() => result.current.restart())
  expect(result.current).toMatchObject({ seconds: 0, playing: true, finished: false })
})

it('holds its time while paused', () => {
  const { result } = renderHook(() => usePlayback(10))
  nextFrame(50)
  const paused = result.current.seconds

  act(() => result.current.pause())

  expect(result.current.seconds).toBe(paused)
  expect(result.current.playing).toBe(false)
})
