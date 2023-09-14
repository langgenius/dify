import React, { useEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'
import { t } from 'i18next'
import CryptoJS from 'crypto-js'

let mermaidAPI: any
mermaidAPI = null

if (typeof window !== 'undefined') {
  mermaid.initialize({
    startOnLoad: true,
    theme: 'default',
    flowchart: {
      htmlLabels: true,
      useMaxWidth: true,
    },
  })
  mermaidAPI = mermaid.mermaidAPI
}

const style = {
  minWidth: '480px',
  height: 'auto',
  overflow: 'auto',
}

// eslint-disable-next-line react/display-name
const Flowchart = React.forwardRef((props: {
  PrimitiveCode: string
}, ref) => {
  const [svgCode, setSvgCode] = useState(null)
  const chartId = useRef(`flowchart_${CryptoJS.MD5(props.PrimitiveCode).toString()}`)
  const [isRender, setIsRender] = useState(true)

  const renderFlowchart = async (PrimitiveCode: string) => {
    try {
      const cachedSvg: any = localStorage.getItem(chartId.current)
      if (cachedSvg) {
        setSvgCode(cachedSvg)
        return
      }

      if (typeof window !== 'undefined' && mermaidAPI) {
        const svgGraph = await mermaidAPI.render(chartId.current, PrimitiveCode)
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        const base64Svg: any = await svgToBase64(svgGraph.svg)
        localStorage.setItem(chartId.current, base64Svg)
        setSvgCode(base64Svg)
      }
    }
    catch (error) {
      localStorage.clear()
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      console.error(error.toString())
    }
  }

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

  const handleReRender = () => {
    setIsRender(false)
    setSvgCode(null)
    localStorage.removeItem(chartId.current)
    setTimeout(() => {
      setIsRender(true)
      renderFlowchart(props.PrimitiveCode)
    }, 100)
  }

  useEffect(() => {
    setIsRender(false)
    setTimeout(() => {
      setIsRender(true)
      renderFlowchart(props.PrimitiveCode)
    }, 100)
  }, [props.PrimitiveCode])

  return (
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    <div ref={ref}>
      {
        isRender && <div id={chartId.current} className="mermaid" style={style}>{svgCode && (<img src={svgCode} style={{ width: '100%', height: 'auto' }} alt="Mermaid chart" />)}</div>
      }
      <button onClick={handleReRender}>{t('appApi.merMaind.rerender')}</button>
    </div>
  )
})

export default Flowchart
