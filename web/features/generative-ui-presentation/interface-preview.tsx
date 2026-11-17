'use client'

import { useEffect, useState } from 'react'
import { useTranslation } from '#i18n'
import { GENERATIVE_UI_LIBRARY_VERSION } from '@/features/generative-ui/registry/definitions'
import { GenerativeUIRenderer } from '@/features/generative-ui/renderer'

export function InterfacePreview({ replay = false }: { replay?: boolean }) {
  const { t } = useTranslation(['presentation'])
  const [visibleLength, setVisibleLength] = useState(0)
  const source = `root = Stack([sales, trend])
sales = MetricCard(${JSON.stringify(t(($) => $['preview.sales']))}, 144, 120, ${JSON.stringify(t(($) => $['preview.unit']))}, ${JSON.stringify(t(($) => $['preview.comparison']))}, true)
trend = LineChart(${JSON.stringify(t(($) => $['preview.trend']))}, ${JSON.stringify([
    { label: '01', value: 80 },
    { label: '02', value: 96 },
    { label: '03', value: 90 },
    { label: '04', value: 108 },
    { label: '05', value: 120 },
    { label: '06', value: 144 },
  ])}, ${JSON.stringify(t(($) => $['preview.unit']))})`

  useEffect(() => {
    if (!replay) return
    let position = 0
    const timer = setInterval(() => {
      position = Math.min(position + 32, source.length)
      setVisibleLength(position)
      if (position === source.length) clearInterval(timer)
    }, 120)
    return () => clearInterval(timer)
  }, [replay, source])

  return (
    <figure className="interface-preview">
      <div className="preview-window-bar" aria-hidden="true">
        <span />
        <span />
        <span />
        <span className="preview-window-name">Dify</span>
        <span className="preview-window-icon i-ri-layout-masonry-line" />
      </div>
      <div className="preview-prompt">
        <span aria-hidden="true" className="i-ri-sparkling-2-line" />
        <p>{t(($) => $['preview.prompt'])}</p>
      </div>
      <div className="preview-body">
        <GenerativeUIRenderer
          source={replay ? source.slice(0, visibleLength) : source}
          libraryVersion={GENERATIVE_UI_LIBRARY_VERSION}
          isStreaming={replay && visibleLength < source.length}
          isReadOnly
          fallbackText={t(($) => $['preview.caption'])}
        />
      </div>
      <figcaption className="preview-caption">{t(($) => $['preview.caption'])}</figcaption>
    </figure>
  )
}
