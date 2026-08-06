import AudioPlayer from '@/app/components/base/audio-btn/audio'

declare global {
  // oxlint-disable-next-line typescript/consistent-type-definitions
  interface AudioPlayerManager {
    instance: AudioPlayerManager
  }
}

export class AudioPlayerManager {
  private static instance: AudioPlayerManager
  private audioPlayers: AudioPlayer | null = null
  private autoPlayAudioPlayer: AudioPlayer | null = null
  private msgId: string | undefined

  public static getInstance(): AudioPlayerManager {
    if (!AudioPlayerManager.instance) {
      AudioPlayerManager.instance = new AudioPlayerManager()
      this.instance = AudioPlayerManager.instance
    }

    return AudioPlayerManager.instance
  }

  public getAudioPlayer(
    url: string,
    isPublic: boolean,
    id: string | undefined,
    msgContent: string | null | undefined,
    voice: string | undefined,
    callback: ((event: string) => void) | null,
  ): AudioPlayer {
    if (this.msgId && this.msgId === id && this.audioPlayers) {
      this.audioPlayers.setCallback(callback)
      return this.audioPlayers
    } else {
      if (this.audioPlayers) {
        if (this.autoPlayAudioPlayer === this.audioPlayers) this.autoPlayAudioPlayer = null
        try {
          this.audioPlayers.destroy()
        } catch {}
      }

      this.msgId = id
      this.audioPlayers = new AudioPlayer(url, isPublic, id, msgContent, voice, callback)
      return this.audioPlayers
    }
  }

  public getAutoPlayAudioPlayer(
    url: string,
    isPublic: boolean,
    id: string | undefined,
    msgContent: string | null | undefined,
    voice: string | undefined,
    callback: ((event: string) => void) | null,
  ): AudioPlayer {
    const player = this.getAudioPlayer(url, isPublic, id, msgContent, voice, callback)
    this.autoPlayAudioPlayer = player
    return player
  }

  public destroyAutoPlayAudioPlayer(player: AudioPlayer | null) {
    if (!player || player !== this.autoPlayAudioPlayer) return

    this.autoPlayAudioPlayer = null
    if (this.audioPlayers === player) {
      this.audioPlayers = null
      this.msgId = undefined
    }

    try {
      player.destroy()
    } catch {}
  }

  public destroyCurrentAutoPlayAudioPlayer() {
    this.destroyAutoPlayAudioPlayer(this.autoPlayAudioPlayer)
  }

  public resetMsgId(msgId: string) {
    this.msgId = msgId
    this.audioPlayers?.resetMsgId(msgId)
  }
}
