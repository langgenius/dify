import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams, usePathname } from 'next/navigation'
import {
  RiCloseLine,
  RiLoader2Line,
} from '@remixicon/react'
import Recorder from 'js-audio-recorder'
import { useRafInterval } from 'ahooks'
import { convertToMp3 } from './utils'
import s from './index.module.css'
import cn from '@/utils/classnames'
import { StopCircle } from '@/app/components/base/icons/src/vender/solid/mediaAndDevices'
import { audioToText } from '@/service/share'

type VoiceInputTypes = {
  onConverted: (text: string) => void
  onCancel: () => void
  wordTimestamps?: string
}

const VoiceInput = ({
  onCancel,
  onConverted,
  wordTimestamps,
}: VoiceInputTypes) => {
  const { t } = useTranslation()
  const recorder = useRef(new Recorder({
    sampleBits: 16,
    sampleRate: 16000,
    numChannels: 1,
    compiling: false,
  }))
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const drawRecordId = useRef<number | null>(null)
  const [originDuration, setOriginDuration] = useState(0)
  const [startRecord, setStartRecord] = useState(false)
  const [startConvert, setStartConvert] = useState(false)
  const pathname = usePathname()
  const params = useParams()
  const clearInterval = useRafInterval(() => {
    setOriginDuration(originDuration + 1)
  }, 1000)

  const drawRecord = useCallback(() => {
    drawRecordId.current = requestAnimationFrame(drawRecord)
    const canvas = canvasRef.current!
    const ctx = ctxRef.current!
    const dataUnit8Array = recorder.current.getRecordAnalyseData()
    const dataArray = [].slice.call(dataUnit8Array)
    const lineLength = parseInt(`${canvas.width / 3}`)
    const gap = parseInt(`${1024 / lineLength}`)

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.beginPath()
    let x = 0
    for (let i = 0; i < lineLength; i++) {
      let v = dataArray.slice(i * gap, i * gap + gap).reduce((prev: number, next: number) => {
        return prev + next
      }, 0) / gap

      if (v < 128)
        v = 128
      if (v > 178)
        v = 178
      const y = (v - 128) / 50 * canvas.height

      ctx.moveTo(x, 16)
      if (ctx.roundRect)
        ctx.roundRect(x, 16 - y, 2, y, [1, 1, 0, 0])
      else
        ctx.rect(x, 16 - y, 2, y)
      ctx.fill()
      x += 3
    }
    ctx.closePath()
  }, [])
  const handleStopRecorder = useCallback(async () => {
    clearInterval()
    setStartRecord(false)
    setStartConvert(true)
    recorder.current.stop()
    drawRecordId.current && cancelAnimationFrame(drawRecordId.current)
    drawRecordId.current = null
    const canvas = canvasRef.current!
    const ctx = ctxRef.current!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const mp3Blob = convertToMp3(recorder.current)
    const mp3File = new File([mp3Blob], 'temp.mp3', { type: 'audio/mp3' })
    const formData = new FormData()
    formData.append('file', mp3File)
    formData.append('word_timestamps', wordTimestamps || 'disabled')

    let url = ''
    let isPublic = false

    if (params.token) {
      url = '/audio-to-text'
      isPublic = true
    }
    else if (params.appId) {
      if (pathname.search('explore/installed') > -1)
        url = `/installed-apps/${params.appId}/audio-to-text`
      else
        url = `/apps/${params.appId}/audio-to-text`
    }

    try {
      const audioResponse = await audioToText(url, isPublic, formData)
      onConverted(audioResponse.text)
      onCancel()
    }
    catch (e) {
      onConverted('')
      onCancel()
    }
  }, [clearInterval, onCancel, onConverted, params.appId, params.token, pathname, wordTimestamps])
  const handleStartRecord = async () => {
    try {
      await recorder.current.start()
      setStartRecord(true)
      setStartConvert(false)

      if (canvasRef.current && ctxRef.current)
        drawRecord()
    }
    catch (e) {
      onCancel()
    }
  }

  const initCanvas = () => {
    const dpr = window.devicePixelRatio || 1
    const canvas = document.getElementById('voice-input-record') as HTMLCanvasElement

    if (canvas) {
      const { width: cssWidth, height: cssHeight } = canvas.getBoundingClientRect()

      canvas.width = dpr * cssWidth
      canvas.height = dpr * cssHeight
      canvasRef.current = canvas

      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.scale(dpr, dpr)
        ctx.fillStyle = 'rgba(209, 224, 255, 1)'
        ctxRef.current = ctx
      }
    }
  }
  if (originDuration >= 600 && startRecord)
    handleStopRecorder()

  useEffect(() => {
    initCanvas()
    handleStartRecord()
    const recorderRef = recorder?.current
    return () => {
      recorderRef?.stop()
    }
  }, [])

  const minutes = parseInt(`${parseInt(`${originDuration}`) / 60}`)
  const seconds = parseInt(`${originDuration}`) % 60

  return (
    <div className={cn(s.wrapper, 'absolute inset-0 rounded-xl')}>
      <div className='absolute inset-[1.5px] flex items-center pl-[14.5px] pr-[6.5px] py-[14px] bg-primary-25 rounded-[10.5px] overflow-hidden'>
        <canvas id='voice-input-record' className='absolute left-0 bottom-0 w-full h-4' />
        {
          startConvert && <RiLoader2Line className='animate-spin mr-2 w-4 h-4 text-primary-700' />
        }
        <div className='grow'>
          {
            startRecord && (
              <div className='text-sm text-gray-500'>
                {t('common.voiceInput.speaking')}
              </div>
            )
          }
          {
            startConvert && (
              <div className={cn(s.convert, 'text-sm')}>
                {t('common.voiceInput.converting')}
              </div>
            )
          }
        </div>
        {
          startRecord && (
            <div
              className='flex justify-center items-center mr-1 w-8 h-8 hover:bg-primary-100 rounded-lg  cursor-pointer'
              onClick={handleStopRecorder}
            >
              <StopCircle className='w-5 h-5 text-primary-600' />
            </div>
          )
        }
        {
          startConvert && (
            <div
              className='flex justify-center items-center mr-1 w-8 h-8 hover:bg-gray-200 rounded-lg  cursor-pointer'
              onClick={onCancel}
            >
              <RiCloseLine className='w-4 h-4 text-gray-500' />
            </div>
          )
        }
        <div className={`w-[45px] pl-1 text-xs font-medium ${originDuration > 500 ? 'text-[#F04438]' : 'text-gray-700'}`}>{`0${minutes.toFixed(0)}:${seconds >= 10 ? seconds : `0${seconds}`}`}</div>
      </div>
    </div>
  )
}

export default VoiceInput
