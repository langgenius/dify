import { AppSourceType, textToAudioStream } from '@/service/share'

const DEFAULT_AUDIO_CONTENT_TYPE = 'audio/mpeg'

declare global {
  // oxlint-disable-next-line typescript/consistent-type-definitions
  interface Window {
    ManagedMediaSource?: typeof MediaSource
  }
}
export class AudioPlayer {
  mediaSource: MediaSource | null
  audio: HTMLAudioElement
  audioContext: AudioContext
  sourceBuffer?: SourceBuffer
  cacheBuffers: ArrayBuffer[] = []
  msgId: string | undefined
  msgContent: string | null | undefined = null
  voice: string | undefined = undefined
  isLoadData = false
  url: string
  isPublic: boolean
  callback: ((event: string) => void) | null
  private objectUrl = ''
  private streamEnded = false
  private endOfStreamCalled = false
  private destroyed = false
  private pendingPlaybackSource: string | null = null
  private playWhenReady = false
  private mediaSourceDisabled = false
  private sourceOpenListener?: () => void
  private audioMimeType = DEFAULT_AUDIO_CONTENT_TYPE
  private reader?: ReadableStreamDefaultReader<Uint8Array>
  constructor(
    streamUrl: string,
    isPublic: boolean,
    msgId: string | undefined,
    msgContent: string | null | undefined,
    voice: string | undefined,
    callback: ((event: string) => void) | null,
  ) {
    this.audioContext = new AudioContext()
    this.msgId = msgId
    this.msgContent = msgContent
    this.url = streamUrl
    this.isPublic = isPublic
    this.voice = voice
    this.callback = callback
    this.audio = new Audio()
    this.mediaSource = null
    this.initializeMediaSource()
    this.setCallback(callback)
    const source = this.audioContext.createMediaElementSource(this.audio)
    source.connect(this.audioContext.destination)
  }

  public resetMsgId(msgId: string) {
    this.msgId = msgId
  }

  private listenMediaSource(contentType: string) {
    this.sourceOpenListener = () => {
      if (this.destroyed || this.sourceBuffer) return
      try {
        this.sourceBuffer = this.mediaSource?.addSourceBuffer(contentType)
        this.sourceBuffer?.addEventListener('updateend', this.flushBuffers)
        this.flushBuffers()
      } catch {
        this.mediaSourceDisabled = true
        this.releaseMediaSource()
        if (this.streamEnded) this.finishBlobAudio()
      }
    }
    this.mediaSource?.addEventListener('sourceopen', this.sourceOpenListener)
  }

  private initializeMediaSource() {
    if (this.destroyed || this.mediaSourceDisabled) return

    const MediaSourceConstructor = window.ManagedMediaSource || window.MediaSource
    const isManagedMediaSource = Boolean(
      window.ManagedMediaSource && MediaSourceConstructor === window.ManagedMediaSource,
    )
    const supportsStreaming =
      this.audioMimeType === DEFAULT_AUDIO_CONTENT_TYPE &&
      Boolean(MediaSourceConstructor?.isTypeSupported?.(this.audioMimeType))
    if (!supportsStreaming || !MediaSourceConstructor) return

    this.mediaSource = new MediaSourceConstructor()
    if (isManagedMediaSource) {
      this.audio.disableRemotePlayback = true
      this.audio.controls = true
    }
    this.listenMediaSource(this.audioMimeType)
    this.objectUrl = URL.createObjectURL(this.mediaSource)
    this.audio.src = this.objectUrl
    this.audio.autoplay = true
  }

  private setAudioMimeType(audioType: string | null | undefined) {
    const mimeType = audioType?.split(';', 1)[0]?.trim() || DEFAULT_AUDIO_CONTENT_TYPE
    if (mimeType !== this.audioMimeType) {
      this.audioMimeType = mimeType
      this.releaseMediaSource()
    }

    if (!this.streamEnded && !this.mediaSource && !this.objectUrl) this.initializeMediaSource()
    if (this.mediaSource && this.playWhenReady) this.requestPlayback()
  }

  private releaseMediaSource() {
    if (this.sourceOpenListener)
      this.mediaSource?.removeEventListener('sourceopen', this.sourceOpenListener)

    if (this.sourceBuffer) {
      this.sourceBuffer.removeEventListener('updateend', this.flushBuffers)
      if (this.mediaSource?.readyState === 'open') {
        try {
          this.sourceBuffer.abort()
        } catch {}
      }
    }

    this.sourceBuffer = undefined
    this.mediaSource = null
    this.endOfStreamCalled = false
    this.audio.autoplay = false
    this.releaseObjectUrl()
  }

  private failLoad() {
    this.cacheBuffers = []
    this.streamEnded = false
    this.releaseMediaSource()
    this.isLoadData = false
    this.callback?.('error')
  }

  private flushBuffers = () => {
    if (
      this.destroyed ||
      !this.sourceBuffer ||
      this.sourceBuffer.updating ||
      this.mediaSource?.readyState !== 'open'
    )
      return

    const nextBuffer = this.cacheBuffers.shift()
    if (nextBuffer) {
      this.sourceBuffer.appendBuffer(nextBuffer)
      return
    }

    if (this.streamEnded && !this.endOfStreamCalled) {
      this.endOfStreamCalled = true
      this.mediaSource.endOfStream()
    }
  }

  private requestPlayback(reportIfPlaying = false) {
    const playbackSource = this.objectUrl
    if (this.destroyed || !playbackSource || this.pendingPlaybackSource === playbackSource) return
    if (!this.isAudioContextPaused() && !this.audio.paused && !this.audio.ended) {
      if (reportIfPlaying) this.callback?.('play')
      return
    }

    this.pendingPlaybackSource = playbackSource
    void this.resumeAndPlay(playbackSource)
  }

  private isAudioContextPaused() {
    return this.audioContext.state === 'suspended' || this.audioContext.state === 'interrupted'
  }

  private async resumeAndPlay(playbackSource: string) {
    try {
      const pendingOperations: Promise<unknown>[] = []
      if (this.isAudioContextPaused()) pendingOperations.push(this.audioContext.resume())
      if (this.audio.paused || this.audio.ended) pendingOperations.push(this.audio.play())

      await Promise.all(pendingOperations)
      if (this.destroyed || !this.playWhenReady || playbackSource !== this.objectUrl) return
      if (this.isAudioContextPaused()) {
        this.callback?.('error')
        return
      }

      this.callback?.('play')
    } catch {
      if (!this.destroyed && this.playWhenReady && playbackSource === this.objectUrl)
        this.callback?.('error')
    } finally {
      if (this.pendingPlaybackSource === playbackSource) this.pendingPlaybackSource = null
    }
  }

  public setCallback(callback: ((event: string) => void) | null) {
    this.callback = callback
    if (callback) {
      this.audio.addEventListener(
        'ended',
        () => {
          callback('ended')
        },
        false,
      )
      this.audio.addEventListener(
        'pause',
        () => {
          callback('paused')
        },
        true,
      )
      this.audio.addEventListener(
        'loadeddata',
        () => {
          callback('loaded')
        },
        true,
      )
      this.audio.addEventListener(
        'play',
        () => {
          callback('play')
        },
        true,
      )
      this.audio.addEventListener(
        'timeupdate',
        () => {
          callback('timeupdate')
        },
        true,
      )
      this.audio.addEventListener(
        'canplay',
        () => {
          callback('canplay')
        },
        true,
      )
      this.audio.addEventListener(
        'error',
        () => {
          callback('error')
        },
        true,
      )
    }
  }

  private async loadAudio() {
    try {
      const audioResponse = (await textToAudioStream(
        this.url,
        this.isPublic ? AppSourceType.webApp : AppSourceType.installedApp,
        {
          message_id: this.msgId,
          streaming: true,
          voice: this.voice,
          text: this.msgContent,
        },
      )) as Response
      if (this.destroyed) return
      if (audioResponse.status !== 200) {
        this.failLoad()
        return
      }
      this.setAudioMimeType(audioResponse.headers.get('content-type'))
      if (!audioResponse.body) throw new Error('Audio response body is missing')
      const reader = audioResponse.body.getReader()
      this.reader = reader
      while (true) {
        const { value, done } = await reader.read()
        if (this.destroyed) return
        if (value?.byteLength) this.receiveAudioData(value)
        if (done) {
          this.finishStream()
          break
        }
      }
    } catch {
      if (!this.destroyed) this.failLoad()
    } finally {
      this.reader = undefined
    }
  }

  // play audio
  public playAudio() {
    this.playWhenReady = true
    if (this.isLoadData) {
      if (!this.mediaSource && !this.objectUrl) {
        if (this.isAudioContextPaused()) void this.audioContext.resume().catch(() => {})
        return
      }
      this.requestPlayback(true)
    } else {
      this.isLoadData = true
      if (this.mediaSource) this.requestPlayback(true)
      else if (this.isAudioContextPaused()) void this.audioContext.resume().catch(() => {})
      this.loadAudio()
    }
  }

  private finishStream() {
    if (this.destroyed) return
    this.streamEnded = true
    if (this.mediaSource) {
      this.flushBuffers()
      return
    }

    this.finishBlobAudio()
  }

  public async playAudioWithAudio(audio: string, play = true, audioType?: string) {
    if (!audio || !audio.length) {
      this.finishStream()
      return
    }
    this.setAudioMimeType(audioType)
    const audioContent = Uint8Array.from(atob(audio), (char) => char.charCodeAt(0))
    this.receiveAudioData(audioContent)
    if (play) {
      this.isLoadData = true
      this.playWhenReady = true
      if (this.mediaSource) this.requestPlayback()
    }
  }

  public pauseAudio() {
    this.playWhenReady = false
    this.callback?.('paused')
    this.audio.pause()
    void this.audioContext.suspend().catch(() => {})
  }

  public destroy() {
    if (this.destroyed) return

    this.destroyed = true
    this.cacheBuffers = []
    void this.reader?.cancel().catch(() => {})
    this.reader = undefined
    this.callback?.('paused')
    this.audio.pause()

    this.releaseMediaSource()
    void this.audioContext.close().catch(() => {})
  }

  private receiveAudioData(unit8Array: Uint8Array | undefined) {
    if (this.destroyed || this.streamEnded) return
    if (!unit8Array) {
      this.finishStream()
      return
    }
    const audioData = this.byteArrayToArrayBuffer(unit8Array)
    if (!audioData.byteLength) {
      this.finishStream()
      return
    }
    this.cacheBuffers.push(audioData)
    this.flushBuffers()
  }

  private finishBlobAudio() {
    if (!this.cacheBuffers.length) {
      if (!this.objectUrl) this.isLoadData = false
      return
    }

    const audioBlob = new Blob(this.cacheBuffers, { type: this.audioMimeType })
    this.cacheBuffers = []
    this.releaseObjectUrl()
    this.objectUrl = URL.createObjectURL(audioBlob)
    this.audio.src = this.objectUrl
    this.isLoadData = true
    if (this.playWhenReady) this.requestPlayback()
  }

  private releaseObjectUrl() {
    if (!this.objectUrl) return

    URL.revokeObjectURL(this.objectUrl)
    this.objectUrl = ''
    this.audio.src = ''
  }

  private byteArrayToArrayBuffer(byteArray: Uint8Array): ArrayBuffer {
    const arrayBuffer = new ArrayBuffer(byteArray.length)
    const uint8Array = new Uint8Array(arrayBuffer)
    uint8Array.set(byteArray)
    return arrayBuffer
  }
}
