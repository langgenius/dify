import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import Recorder from 'js-audio-recorder'
import s from './index.module.css'
import { StopCircle } from '@/app/components/base/icons/src/vender/solid/mediaAndDevices'
import { Loading02, XClose } from '@/app/components/base/icons/src/vender/line/general'

type VoiceInputTypes = {
  onConverted: (text: string) => void
  onCancel: () => void
}

const VoiceInput = ({
  onCancel,
  onConverted,
}: VoiceInputTypes) => {
  const { t } = useTranslation()
  const recorder = useRef(new Recorder())
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const drawRecordId = useRef<number | null>(null)
  const [duration, setDuration] = useState('00:00')
  const [startRecord, setStartRecord] = useState(false)
  const [startConvert, setStartConvert] = useState(false)
  const drawRecord = useCallback(() => {
    drawRecordId.current = requestAnimationFrame(drawRecord)
    const canvas = canvasRef.current!
    const ctx = ctxRef.current!
    const dataArray = recorder.current.getRecordAnalyseData()
    const lineLength = parseInt(`${canvas.width / 3}`)
    const gap = parseInt(`${1024 / lineLength}`)

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.beginPath()
    let x = 0
    for (let i = 0; i < lineLength; i++) {
      let v = dataArray[i * gap]
      if (v < 128)
        v = 128
      if (v > 178)
        v = 178
      const y = (v - 128) / 50 * canvas.height

      ctx.moveTo(x, 16)
      ctx.roundRect(x, 16 - y, 2, y, [1, 1, 0, 0])
      ctx.fill()
      x += 3
    }
    ctx.closePath()
  }, [])
  const handleStopRecorder = useCallback(() => {
    setStartRecord(false)
    setStartConvert(true)
    recorder.current.stop()
    drawRecordId.current && cancelAnimationFrame(drawRecordId.current)
    drawRecordId.current = null
    // const wavBlob = recorder.current.getWAVBlob()
    // const wavFile = new File([wavBlob], 'audio.wav', { type: 'audio/wav' })
    // onConverted('')
  }, [])
  const handleStartRecord = () => {
    setStartRecord(true)
    setStartConvert(false)
    recorder.current.start()
    recorder.current.onprogress = (params) => {
      const originDuration = params.duration
      if (originDuration > 65) {
        console.log('stop')
        handleStopRecorder()
      }
      const minutes = parseInt(`${parseInt(`${originDuration}`) / 60}`)
      const seconds = parseInt(`${originDuration}`) % 60
      setDuration(`0${minutes.toFixed(0)}:${seconds >= 10 ? seconds : `0${seconds}`}`)
    }
    if (canvasRef.current && ctxRef.current)
      drawRecord()
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
  useEffect(() => {
    initCanvas()
    handleStartRecord()
  }, [])

  return (
    <div className={cn(s.wrapper, 'absolute inset-0 rounded-xl')}>
      <div className='absolute inset-[1.5px] flex items-center pl-[14.5px] pr-[6.5px] py-[14px] bg-primary-25 rounded-[10.5px] overflow-hidden'>
        {
          startRecord && <canvas id='voice-input-record' className='absolute left-0 bottom-0 w-full h-4' />
        }
        {
          startConvert && <Loading02 className='animate-spin mr-2 w-4 h-4 text-primary-700' />
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
              className='flex justify-center items-center mr-1 w-8 h-8 hover:bg-primary-100 rounded-lg  cursor-pointer'
              onClick={onCancel}
            >
              <XClose className='w-4 h-4 text-gray-500' />
            </div>
          )
        }
        <div className='w-[45px] pl-1 text-xs font-medium text-gray-700'>{duration}</div>
      </div>
    </div>
  )
}

export default VoiceInput
