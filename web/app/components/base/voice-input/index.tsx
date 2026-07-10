import type { VoiceRecorder } from './recorder'
import type { SpeechToTextTarget } from './types'
import { cn } from '@langgenius/dify-ui/cn'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { transcribeAudio } from './api'
import s from './index.module.css'
import { startVoiceRecorder } from './recorder'

const MAX_RECORDING_DURATION = 600

type VoiceInputStatus = 'starting' | 'recording' | 'converting'

type VoiceInputProps = {
  onConverted: (text: string) => void
  onCancel: () => void
  onBeforeTranscribe?: () => Promise<unknown>
  onError?: () => void
  onStartError?: () => void
  target: SpeechToTextTarget
}

function VoiceInput({
  onCancel,
  onBeforeTranscribe,
  onConverted,
  onError,
  onStartError,
  target,
}: VoiceInputProps) {
  const { t } = useTranslation()
  const recorderRef = useRef<VoiceRecorder | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const canvasContextRef = useRef<CanvasRenderingContext2D | null>(null)
  const canvasSizeRef = useRef({ height: 0, width: 0 })
  const drawRecordIdRef = useRef<number | null>(null)
  const mountedRef = useRef(true)
  const stopRequestedRef = useRef(false)
  const cancelledRef = useRef(false)
  const transcriptionAbortControllerRef = useRef<AbortController | null>(null)
  const [duration, setDuration] = useState(0)
  const [status, setStatus] = useState<VoiceInputStatus>('starting')

  const stopDrawing = useCallback(() => {
    if (drawRecordIdRef.current !== null)
      cancelAnimationFrame(drawRecordIdRef.current)
    drawRecordIdRef.current = null
    const { height, width } = canvasSizeRef.current
    canvasContextRef.current?.clearRect(0, 0, width, height)
  }, [])

  const drawRecord = useCallback(() => {
    const recorder = recorderRef.current
    const context = canvasContextRef.current
    const { height, width } = canvasSizeRef.current
    if (!recorder || !context || !height || !width)
      return

    const frequencyData = new Uint8Array(recorder.analyser.frequencyBinCount)
    recorder.analyser.getByteFrequencyData(frequencyData)
    const lineCount = Math.max(1, Math.floor(width / 3))
    const sampleStep = Math.max(1, Math.floor(frequencyData.length / lineCount))

    context.clearRect(0, 0, width, height)
    context.beginPath()
    for (let index = 0; index < lineCount; index++) {
      const amplitude = frequencyData[index * sampleStep] ?? 0
      const lineHeight = Math.max(1, amplitude / 255 * height)
      const x = index * 3
      if (context.roundRect)
        context.roundRect(x, height - lineHeight, 2, lineHeight, [1, 1, 0, 0])
      else
        context.rect(x, height - lineHeight, 2, lineHeight)
    }
    context.fill()
    context.closePath()
    drawRecordIdRef.current = requestAnimationFrame(drawRecord)
  }, [])

  const handleStopRecorder = useCallback(async () => {
    const recorder = recorderRef.current
    if (!recorder || status !== 'recording' || stopRequestedRef.current)
      return

    stopRequestedRef.current = true
    setStatus('converting')
    stopDrawing()
    try {
      const mp3Blob = await recorder.stop()
      if (cancelledRef.current)
        return

      await onBeforeTranscribe?.()
      if (cancelledRef.current)
        return

      const file = new File([mp3Blob], 'temp.mp3', { type: 'audio/mp3' })
      const abortController = new AbortController()
      transcriptionAbortControllerRef.current = abortController
      const audioResponse = await transcribeAudio(target, file, abortController.signal)
      if (mountedRef.current && !cancelledRef.current)
        onConverted(audioResponse.text)
    }
    catch {
      if (mountedRef.current && !cancelledRef.current)
        onError?.()
    }
    finally {
      transcriptionAbortControllerRef.current = null
      if (mountedRef.current && !cancelledRef.current)
        onCancel()
    }
  }, [onBeforeTranscribe, onCancel, onConverted, onError, status, stopDrawing, target])

  const handleCancel = useCallback(() => {
    cancelledRef.current = true
    transcriptionAbortControllerRef.current?.abort()
    void recorderRef.current?.cancel()
    onCancel()
  }, [onCancel])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas)
      return
    const devicePixelRatio = window.devicePixelRatio || 1
    const { height, width } = canvas.getBoundingClientRect()
    canvas.width = devicePixelRatio * width
    canvas.height = devicePixelRatio * height
    canvasSizeRef.current = { height, width }
    const context = canvas.getContext('2d')
    if (!context)
      return
    context.scale(devicePixelRatio, devicePixelRatio)
    context.fillStyle = 'rgba(209, 224, 255, 1)'
    canvasContextRef.current = context
  }, [])

  useEffect(() => {
    mountedRef.current = true
    cancelledRef.current = false
    let effectCancelled = false
    void startVoiceRecorder().then((recorder) => {
      if (effectCancelled) {
        void recorder.cancel()
        return
      }
      recorderRef.current = recorder
      setStatus('recording')
      drawRecord()
    }).catch(() => {
      if (effectCancelled)
        return
      onStartError?.()
      onCancel()
    })

    return () => {
      effectCancelled = true
      mountedRef.current = false
      cancelledRef.current = true
      transcriptionAbortControllerRef.current?.abort()
      stopDrawing()
      void recorderRef.current?.cancel()
    }
  }, [drawRecord, onCancel, onStartError, stopDrawing])

  useEffect(() => {
    if (status !== 'recording')
      return
    const intervalId = window.setInterval(() => {
      setDuration(currentDuration => currentDuration + 1)
    }, 1000)
    return () => window.clearInterval(intervalId)
  }, [status])

  useEffect(() => {
    if (duration >= MAX_RECORDING_DURATION && status === 'recording')
      void handleStopRecorder()
  }, [duration, handleStopRecorder, status])

  const minutes = Math.floor(duration / 60).toString().padStart(2, '0')
  const seconds = (duration % 60).toString().padStart(2, '0')
  const isRecording = status === 'recording'
  const isConverting = status === 'converting'

  return (
    <div className={cn(s.wrapper, 'absolute inset-0 rounded-xl')}>
      <div className="absolute inset-[1.5px] flex items-center overflow-hidden rounded-[10.5px] bg-primary-25 py-[14px] pr-[6.5px] pl-[14.5px]">
        <canvas ref={canvasRef} className="absolute bottom-0 left-0 h-4 w-full" />
        {isConverting && <div className="mr-2 i-ri-loader-2-line size-4 animate-spin text-primary-700" aria-hidden="true" data-testid="voice-input-loader" />}
        <div className="grow">
          {isRecording && (
            <div className="text-sm text-gray-500">
              {t('voiceInput.speaking', { ns: 'common' })}
            </div>
          )}
          {isConverting && (
            <div className={cn(s.convert, 'text-sm')} role="status" data-testid="voice-input-converting-text">
              {t('voiceInput.converting', { ns: 'common' })}
            </div>
          )}
        </div>
        {isRecording && (
          <button
            type="button"
            className="mr-1 flex size-8 items-center justify-center rounded-lg outline-hidden hover:bg-primary-100 focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            aria-label={t('voiceInput.stop', { ns: 'common' })}
            onClick={handleStopRecorder}
          >
            <span className="i-ri-stop-circle-line size-5 text-primary-600" aria-hidden="true" />
          </button>
        )}
        {isConverting && (
          <button
            type="button"
            className="mr-1 flex size-8 items-center justify-center rounded-lg outline-hidden hover:bg-gray-200 focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            aria-label={t('operation.cancel', { ns: 'common' })}
            onClick={handleCancel}
          >
            <span className="i-ri-close-line size-4 text-gray-500" aria-hidden="true" />
          </button>
        )}
        <div className={cn('w-[45px] pl-1 text-xs font-medium', duration > 500 ? 'text-text-destructive' : 'text-text-secondary')} data-testid="voice-input-timer">
          {`${minutes}:${seconds}`}
        </div>
      </div>
    </div>
  )
}

export default VoiceInput
