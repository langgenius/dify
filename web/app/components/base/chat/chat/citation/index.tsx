import type { FC } from 'react'
import type { CitationItem } from '../type'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Popup from './popup'

export type Resources = {
  documentId: string
  documentName: string
  dataSourceType: string
  sources: CitationItem[]
}

type CitationProps = {
  data: CitationItem[]
  showHitInfo?: boolean
  containerClassName?: string
}
const Citation: FC<CitationProps> = ({
  data,
  showHitInfo,
  containerClassName = 'chat-answer-container',
}) => {
  const { t } = useTranslation()
  const elesRef = useRef<HTMLDivElement[]>([])
  const [limitNumberInOneLine, setLimitNumberInOneLine] = useState(0)
  const [showMore, setShowMore] = useState(false)
  const resources = useMemo(() => data.reduce((prev: Resources[], next) => {
    const documentId = next.document_id
    const documentName = next.document_name
    const dataSourceType = next.data_source_type
    const documentIndex = prev.findIndex(i => i.documentId === documentId)

    if (documentIndex > -1) {
      prev[documentIndex].sources.push(next)
    }
    else {
      prev.push({
        documentId,
        documentName,
        dataSourceType,
        sources: [next],
      })
    }

    return prev
  }, []), [data])

  useEffect(() => {
    const containerWidth = document.querySelector(`.${containerClassName}`)!.clientWidth - 40
    let totalWidth = 0
    let limit = 0
    for (let i = 0; i < resources.length; i++) {
      totalWidth += elesRef.current[i].clientWidth

      if (totalWidth + i * 4 > containerWidth) {
        totalWidth -= elesRef.current[i].clientWidth

        if (totalWidth + 34 > containerWidth)
          limit = i - 1
        else
          limit = i

        break
      }
      else {
        limit = i + 1
      }
    }
    setLimitNumberInOneLine(limit)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const resourcesLength = resources.length

  return (
    <div className="-mb-1 mt-3">
      <div data-testid="citation-title" className="mb-2 flex items-center text-text-tertiary system-xs-medium">
        {t('chat.citation.title', { ns: 'common' })}
        <div className="ml-2 h-px grow bg-divider-regular" />
      </div>
      <div className="relative flex flex-wrap">
        {
          resources.map((res, index) => (
            <div
              key={res.documentId}
              data-testid="citation-measurement-item"
              className="absolute left-0 top-0 -z-10 mb-1 mr-1 h-7 w-auto max-w-[240px] whitespace-nowrap pl-7 pr-2 text-xs opacity-0"
              ref={(ele: HTMLDivElement | null) => { elesRef.current[index] = ele! }}
            >
              {res.documentName}
            </div>
          ))
        }
        {
          resources.slice(0, showMore ? resourcesLength : limitNumberInOneLine).map(res => (
            <div key={res.documentId} className="mb-1 mr-1 cursor-pointer">
              <Popup
                data={res}
                showHitInfo={showHitInfo}
              />
            </div>
          ))
        }
        {
          limitNumberInOneLine < resourcesLength && (
            <div
              data-testid="citation-more-toggle"
              className="flex h-7 cursor-pointer items-center rounded-lg bg-components-panel-bg px-2 text-text-tertiary system-xs-medium"
              onClick={() => setShowMore(v => !v)}
            >
              {
                !showMore
                  ? `+ ${resourcesLength - limitNumberInOneLine}`
                  : <div className="i-ri-arrow-down-s-line h-4 w-4 rotate-180 text-text-tertiary" />
              }
            </div>
          )
        }
      </div>
    </div>
  )
}

export default Citation
