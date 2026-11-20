import {
  demoCommentPosition,
  demoDuration,
  demoMessages,
  getPlaybackFrame,
} from '../playback-script'

describe('getPlaybackFrame', () => {
  it('reveals messages in order and keeps them after their time', () => {
    expect(getPlaybackFrame(0).visibleMessages).toBe(0)
    expect(getPlaybackFrame(demoMessages[0].at).visibleMessages).toBe(1)
    expect(getPlaybackFrame(demoMessages[1].at).visibleMessages).toBe(2)
    expect(getPlaybackFrame(demoDuration).visibleMessages).toBe(3)
  })

  it('is a pure function of time so pause and replay land on the same frame', () => {
    expect(getPlaybackFrame(6.2)).toEqual(getPlaybackFrame(6.2))
  })

  it('shows Sam on the nodes being changed', () => {
    expect(getPlaybackFrame(3.5).samViewing).toBe('checkOrder')
    expect(getPlaybackFrame(6).samViewing).toBe('generateReply')
    expect(getPlaybackFrame(8).samViewing).toBeUndefined()
  })

  it('jumps cursors to their destination under reduced motion', () => {
    expect(getPlaybackFrame(0.5, true).alex).toEqual(demoCommentPosition)
  })
})
