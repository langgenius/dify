import AudioPlayer from '@/app/components/base/audio-btn/audio'
declare global {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface AudioPlayerManager {
    instance: AudioPlayerManager
  }

}

export class AudioPlayerManager {
  private static instance: AudioPlayerManager
  private audioPlayers: AudioPlayer | null = null
  private msgId: string | undefined

  private constructor() {
  }

  public static getInstance(): AudioPlayerManager {
    if (!AudioPlayerManager.instance) {
      AudioPlayerManager.instance = new AudioPlayerManager()
      this.instance = AudioPlayerManager.instance
    }

    return AudioPlayerManager.instance
  }

  public getAudioPlayer(url: string, isPublic: boolean, id: string | undefined, msgContent: string | null | undefined, voice: string | undefined, callback: ((event: string) => {}) | null): AudioPlayer {
    if (this.msgId && this.msgId === id && this.audioPlayers) {
      this.audioPlayers.setCallback(callback)
      return this.audioPlayers
    }
    else {
      if (this.audioPlayers) {
        try {
          this.audioPlayers.pauseAudio()
          this.audioPlayers.cacheBuffers = []
          this.audioPlayers.sourceBuffer?.abort()
        }
        catch (e) {
        }
      }

      this.msgId = id
      this.audioPlayers = new AudioPlayer(url, isPublic, id, msgContent, callback)
      return this.audioPlayers
    }
  }

  public resetMsgId(msgId: string) {
    this.msgId = msgId
    this.audioPlayers?.resetMsgId(msgId)
  }
}
