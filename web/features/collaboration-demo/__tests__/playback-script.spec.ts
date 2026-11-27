import {
  demoCommentPosition,
  demoDuration,
  demoMessages,
  getPlaybackFrame,
} from '../playback-script'

describe('getPlaybackFrame', () => {
  it('places a new comment, types it, then turns it into a thread', () => {
    expect(getPlaybackFrame(0).marker).toBeUndefined()
    expect(getPlaybackFrame(1.2)).toMatchObject({ marker: 'composing', draft: undefined })
    expect(getPlaybackFrame(2.8)).toMatchObject({
      marker: 'composing',
      draft: { message: 'alexAsk', author: 'alex', progress: expect.closeTo(0.5) },
    })
    expect(getPlaybackFrame(demoMessages[0]!.at)).toMatchObject({
      marker: 'thread',
      draft: undefined,
      visibleMessages: 1,
    })
  })

  it('types each reply in the reply bar before it is sent', () => {
    const [, samReply] = demoMessages
    expect(getPlaybackFrame(samReply!.typing[0])).toMatchObject({
      draft: { message: 'samReply', author: 'sam', progress: 0 },
      replyAuthor: 'sam',
      visibleMessages: 1,
    })
    expect(getPlaybackFrame(samReply!.at)).toMatchObject({ draft: undefined, visibleMessages: 2 })
    expect(getPlaybackFrame(demoDuration).visibleMessages).toBe(3)
  })

  it('is a pure function of time so pause and replay land on the same frame', () => {
    expect(getPlaybackFrame(6.2)).toEqual(getPlaybackFrame(6.2))
  })

  it('moves the typing collaborator to the reply bar', () => {
    expect(getPlaybackFrame(12).sam).toMatchObject({ from: 'reply', to: 'reply' })
  })

  it('shows Sam on the nodes being changed', () => {
    expect(getPlaybackFrame(6).samViewing).toBe('checkOrder')
    expect(getPlaybackFrame(9).samViewing).toBe('generateReply')
    expect(getPlaybackFrame(11).samViewing).toBeUndefined()
  })

  it('jumps cursors to their destination under reduced motion', () => {
    expect(getPlaybackFrame(0.5, true).alex).toMatchObject({
      to: demoCommentPosition,
      progress: 1,
    })
  })
})
