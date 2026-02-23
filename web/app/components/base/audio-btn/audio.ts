import Toast from '@/app/components/base/toast'
import { AppSourceType, textToAudioStream } from '@/service/share'

declare global {
  // eslint-disable-next-line ts/consistent-type-definitions
  interface Window {
    ManagedMediaSource: any
  }
}

export default class AudioPlayer {
  mediaSource: MediaSource | null
  audio: HTMLAudioElement
  audioContext: AudioContext
  sourceBuffer?: any
  cacheBuffers: ArrayBuffer[] = []
  pauseTimer: number | null = null
  msgId: string | undefined
  msgContent: string | null | undefined = null
  voice: string | undefined = undefined
  isLoadData = false
  url: string
  isPublic: boolean
  callback: ((event: string) => void) | null

  constructor(streamUrl: string, isPublic: boolean, msgId: string | undefined, msgContent: string | null | undefined, voice: string | undefined, callback: ((event: string) => void) | null) {
    this.audioContext = new AudioContext()
    this.msgId = msgId
    this.msgContent = msgContent
    this.url = streamUrl
    this.isPublic = isPublic
    this.voice = voice
    this.callback = callback

    // Compatible with iphone ios17 ManagedMediaSource
    const MediaSource = window.ManagedMediaSource || window.MediaSource
    if (!MediaSource) {
      Toast.notify({
        message: 'Your browser does not support audio streaming, if you are using an iPhone, please update to iOS 17.1 or later.',
        type: 'error',
      })
    }
    this.mediaSource = MediaSource ? new MediaSource() : null
    this.audio = new Audio()
    this.setCallback(callback)
    if (!window.MediaSource) { // if use  ManagedMediaSource
      this.audio.disableRemotePlayback = true
      this.audio.controls = true
    }
    this.audio.src = this.mediaSource ? URL.createObjectURL(this.mediaSource) : ''
    this.audio.autoplay = true

    const source = this.audioContext.createMediaElementSource(this.audio)
    source.connect(this.audioContext.destination)
    this.listenMediaSource('audio/mpeg')
  }

  public resetMsgId(msgId: string) {
    this.msgId = msgId
  }

  private listenMediaSource(contentType: string) {
    this.mediaSource?.addEventListener('sourceopen', () => {
      if (this.sourceBuffer)
        return

      this.sourceBuffer = this.mediaSource?.addSourceBuffer(contentType)
    })
  }

  public setCallback(callback: ((event: string) => void) | null) {
    this.callback = callback
    if (callback) {
      this.audio.addEventListener('ended', () => {
        callback('ended')
      }, false)
      this.audio.addEventListener('paused', () => {
        callback('paused')
      }, true)
      this.audio.addEventListener('loaded', () => {
        callback('loaded')
      }, true)
      this.audio.addEventListener('play', () => {
        callback('play')
      }, true)
      this.audio.addEventListener('timeupdate', () => {
        callback('timeupdate')
      }, true)
      this.audio.addEventListener('loadeddate', () => {
        callback('loadeddate')
      }, true)
      this.audio.addEventListener('canplay', () => {
        callback('canplay')
      }, true)
      this.audio.addEventListener('error', () => {
        callback('error')
      }, true)
    }
  }

  private async loadAudio() {
    try {
      const audioResponse: any = await textToAudioStream(this.url, this.isPublic ? AppSourceType.webApp : AppSourceType.installedApp, { content_type: 'audio/mpeg' }, {
        message_id: this.msgId,
        streaming: true,
        voice: this.voice,
        text: this.msgContent,
      })

      if (audioResponse.status !== 200) {
        this.isLoadData = false
        if (this.callback)
          this.callback('error')
      }

      const reader = audioResponse.body.getReader()
      while (true) {
        const { value, done } = await reader.read()

        if (done) {
          this.receiveAudioData(value)
          break
        }

        this.receiveAudioData(value)
      }
    }
    catch {
      this.isLoadData = false
      this.callback?.('error')
    }
  }

  // play audio
  public playAudio() {
    if (this.isLoadData) {
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume().then((_) => {
          this.audio.play()
          this.callback?.('play')
        })
      }
      else if (this.audio.ended) {
        this.audio.play()
        this.callback?.('play')
      }
      this.callback?.('play')
    }
    else {
      this.isLoadData = true
      this.loadAudio()
    }
  }

  private theEndOfStream() {
    const endTimer = setInterval(() => {
      if (!this.sourceBuffer?.updating) {
        this.mediaSource?.endOfStream()
        clearInterval(endTimer)
      }
    }, 10)
  }

  private finishStream() {
    const timer = setInterval(() => {
      if (!this.cacheBuffers.length) {
        this.theEndOfStream()
        clearInterval(timer)
      }

      if (this.cacheBuffers.length && !this.sourceBuffer?.updating) {
        const arrayBuffer = this.cacheBuffers.shift()!
        this.sourceBuffer?.appendBuffer(arrayBuffer)
      }
    }, 10)
  }

  public async playAudioWithAudio(audio: string, play = true) {
    if (!audio || !audio.length) {
      this.finishStream()
      return
    }

    const audioContent = Buffer.from(audio, 'base64')
    this.receiveAudioData(new Uint8Array(audioContent))
    if (play) {
      this.isLoadData = true
      if (this.audio.paused) {
        this.audioContext.resume().then((_) => {
          this.audio.play()
          this.callback?.('play')
        })
      }
      else if (this.audio.ended) {
        this.audio.play()
        this.callback?.('play')
      }
      else if (this.audio.played) { /* empty */ }

      else {
        this.audio.play()
        this.callback?.('play')
      }
    }
  }

  public pauseAudio() {
    this.callback?.('paused')
    this.audio.pause()
    this.audioContext.suspend()
  }

  private receiveAudioData(unit8Array: Uint8Array) {
    if (!unit8Array) {
      this.finishStream()
      return
    }
    const audioData = this.byteArrayToArrayBuffer(unit8Array)
    if (!audioData.byteLength) {
      if (this.mediaSource?.readyState === 'open')
        this.finishStream()
      return
    }

    if (this.sourceBuffer?.updating) {
      this.cacheBuffers.push(audioData)
    }
    else {
      if (this.cacheBuffers.length && !this.sourceBuffer?.updating) {
        this.cacheBuffers.push(audioData)
        const cacheBuffer = this.cacheBuffers.shift()!
        this.sourceBuffer?.appendBuffer(cacheBuffer)
      }
      else {
        this.sourceBuffer?.appendBuffer(audioData)
      }
    }
  }

  private byteArrayToArrayBuffer(byteArray: Uint8Array): ArrayBuffer {
    const arrayBuffer = new ArrayBuffer(byteArray.length)
    const uint8Array = new Uint8Array(arrayBuffer)
    uint8Array.set(byteArray)
    return arrayBuffer
  }
}
