import React, { useCallback, useEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'
import { usePrevious } from 'ahooks'
import { useTranslation } from 'react-i18next'
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import LoadingAnim from '@/app/components/base/chat/chat/loading-anim'
import cn from '@/utils/classnames'
import ImagePreview from '@/app/components/base/image-uploader/image-preview'

let mermaidAPI: any
mermaidAPI = null

if (typeof window !== 'undefined')
  mermaidAPI = mermaid.mermaidAPI

const svgToBase64 = (svgGraph: string) => {
  const svgBytes = new TextEncoder().encode(svgGraph)
  const blob = new Blob([svgBytes], { type: 'image/svg+xml;charset=utf-8' })
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

const Flowchart = React.forwardRef((props: {
  PrimitiveCode: string
}, ref) => {
  const { t } = useTranslation()
  const [svgCode, setSvgCode] = useState(null)
  const [look, setLook] = useState<'classic' | 'handDrawn'>('classic')

  const prevPrimitiveCode = usePrevious(props.PrimitiveCode)
  const [isLoading, setIsLoading] = useState(true)
  const timeRef = useRef<NodeJS.Timeout>()
  const [errMsg, setErrMsg] = useState('')
  const [imagePreviewUrl, setImagePreviewUrl] = useState('')

  const renderFlowchart = useCallback(async (PrimitiveCode: string) => {
    setSvgCode(null)
    setIsLoading(true)

    try {
      if (typeof window !== 'undefined' && mermaidAPI) {
        const svgGraph = await mermaidAPI.render('flowchart', PrimitiveCode)
        const base64Svg: any = await svgToBase64(svgGraph.svg)
        setSvgCode(base64Svg)
        setIsLoading(false)
      }
    }
    catch (error) {
      if (prevPrimitiveCode === props.PrimitiveCode) {
        setIsLoading(false)
        setErrMsg((error as Error).message)
      }
    }
  }, [props.PrimitiveCode])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      mermaid.initialize({
        startOnLoad: true,
        theme: 'neutral',
        look,
        flowchart: {
          htmlLabels: true,
          useMaxWidth: true,
        },
      })

      renderFlowchart(props.PrimitiveCode)
    }
  }, [look])

  useEffect(() => {
    if (timeRef.current)
      clearTimeout(timeRef.current)

    timeRef.current = setTimeout(() => {
      renderFlowchart(props.PrimitiveCode)
    }, 300)
  }, [props.PrimitiveCode])

  return (
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    <div ref={ref}>
      <div className="msh-segmented msh-segmented-sm css-23bs09 css-var-r1">
        <div className="msh-segmented-group">
          <label className="msh-segmented-item flex items-center space-x-1 m-2 w-[200px]">
            <div key='classic'
              className={cn('flex items-center justify-center mb-4 w-[calc((100%-8px)/2)] h-8 rounded-lg border border-components-option-card-option-border bg-components-option-card-option-bg cursor-pointer system-sm-medium text-text-secondary',
                look === 'classic' && 'border-[1.5px] border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg text-text-primary',
              )}

              onClick={() => setLook('classic')}
            >
              <div className="msh-segmented-item-label">{t('app.mermaid.classic')}</div>
            </div>
            <div key='handDrawn'
              className={cn(
                'flex items-center justify-center mb-4 w-[calc((100%-8px)/2)] h-8 rounded-lg border border-components-option-card-option-border bg-components-option-card-option-bg cursor-pointer system-sm-medium text-text-secondary',
                look === 'handDrawn' && 'border-[1.5px] border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg text-text-primary',
              )}
              onClick={() => setLook('handDrawn')}
            >
              <div className="msh-segmented-item-label">{t('app.mermaid.handDrawn')}</div>
            </div>
          </label>
        </div>
      </div>
      {
        svgCode
            && <div className="mermaid cursor-pointer h-auto w-full object-fit: cover" onClick={() => setImagePreviewUrl(svgCode)}>
              {svgCode && <img src={svgCode} alt="mermaid_chart" />}
            </div>
      }
      {isLoading
            && <div className='py-4 px-[26px]'>
              <LoadingAnim type='text'/>
            </div>
      }
      {
        errMsg
            && <div className='py-4 px-[26px]'>
              <ExclamationTriangleIcon className='w-6 h-6 text-red-500'/>
              &nbsp;
              {errMsg}
            </div>
      }
      {
        imagePreviewUrl && (<ImagePreview title='mermaid_chart' url={imagePreviewUrl} onCancel={() => setImagePreviewUrl('')} />)
      }
    </div>
  )
})

export default Flowchart
