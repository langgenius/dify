import { AudioPlayerManager } from '@/app/components/base/audio-btn/audio.player.manager'

type PlayerCallback = ((event: string) => void) | null

class MockAudioPlayer {
  private callback: PlayerCallback = null
  private finishTimer?: ReturnType<typeof setTimeout>

  public setCallback(callback: PlayerCallback) {
    this.callback = callback
  }

  public playAudio() {
    this.clearTimer()
    this.callback?.('play')
    this.finishTimer = setTimeout(() => {
      this.callback?.('ended')
    }, 2000)
  }

  public pauseAudio() {
    this.clearTimer()
    this.callback?.('paused')
  }

  private clearTimer() {
    if (this.finishTimer)
      clearTimeout(this.finishTimer)
  }
}

class MockAudioPlayerManager {
  private readonly player = new MockAudioPlayer()

  public getAudioPlayer(
    _url: string,
    _isPublic: boolean,
    _id: string | undefined,
    _msgContent: string | null | undefined,
    _voice: string | undefined,
    callback: PlayerCallback,
  ) {
    this.player.setCallback(callback)
    return this.player
  }

  public resetMsgId() {
    // No-op for the mock
  }
}

export const ensureMockAudioManager = () => {
  const managerAny = AudioPlayerManager as unknown as {
    getInstance: () => AudioPlayerManager
    __isStorybookMockInstalled?: boolean
  }

  if (managerAny.__isStorybookMockInstalled)
    return

  const mock = new MockAudioPlayerManager()
  managerAny.getInstance = () => mock as unknown as AudioPlayerManager
  managerAny.__isStorybookMockInstalled = true
}
