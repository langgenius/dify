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
  const { t } = useTranslation(['common', 'share'])
  const elesRef = useRef<HTMLDivElement[]>([])
  const [limitNumberInOneLine, setLimitNumberInOneLine] = useState(0)
  const [showMore, setShowMore] = useState(false)
  const resources = useMemo(
    () =>
      data.reduce((prev: Resources[], next) => {
        const documentId = next.document_id
        const documentName = next.document_name
        const dataSourceType = next.data_source_type
        const documentIndex = prev.findIndex(
          (i) =>
            i.documentId === documentId &&
            (dataSourceType !== 'knowledge_fs' ||
              (i.sources[0]?.dataset_id === next.dataset_id &&
                i.sources[0]?.document_version === next.document_version)),
        )

        if (documentIndex > -1) {
          prev[documentIndex]!.sources.push(next)
        } else {
          prev.push({
            documentId,
            documentName,
            dataSourceType,
            sources: [next],
          })
        }

        return prev
      }, []),
    [data],
  )

  useEffect(() => {
    const container = document.querySelector(`.${containerClassName}`)
    if (!container) {
      // oxlint-disable-next-line eslint-react/set-state-in-effect -- Citation capacity depends on mounted element widths and must be measured again when the container resizes.
      setLimitNumberInOneLine(resources.length)
      return
    }
    const updateLimit = () => {
      const containerWidth = Math.max(0, container.clientWidth - 40)
      const widths = resources.map((_, index) => elesRef.current[index]?.clientWidth ?? 0)
      const fullWidth =
        widths.reduce((total, width) => total + width, 0) + Math.max(0, widths.length - 1) * 4
      if (fullWidth <= containerWidth) {
        // oxlint-disable-next-line eslint-react/set-state-in-effect -- Citation capacity depends on mounted element widths and must be measured again when the container resizes.
        setLimitNumberInOneLine(resources.length)
        return
      }
      let totalWidth = 0
      let limit = 0
      for (const width of widths) {
        totalWidth += width + (limit > 0 ? 4 : 0)
        // Reserve the overflow button and its gap alongside the visible citations.
        if (totalWidth + 4 + 34 > containerWidth) break
        limit += 1
      }
      // oxlint-disable-next-line eslint-react/set-state-in-effect -- Citation capacity depends on mounted element widths and must be measured again when the container resizes.
      setLimitNumberInOneLine(limit)
    }
    updateLimit()
    const observer = new ResizeObserver(updateLimit)
    observer.observe(container)
    return () => observer.disconnect()
  }, [containerClassName, resources])

  const resourcesLength = resources.length
  const citationTitle = t(($) => $['chat.citation.title'], { ns: 'common' })
  const citationToggleLabel = `${
    showMore
      ? t(($) => $['chat.collapse'], { ns: 'share' })
      : t(($) => $['chat.expand'], { ns: 'share' })
  } ${citationTitle}`

  return (
    <div className="mt-3 -mb-1">
      {data.flatMap((source) =>
        source.knowledge_fs_citation
          ? [<span key={source.knowledge_fs_citation.id} id={source.knowledge_fs_citation.id} />]
          : [],
      )}
      <div
        data-testid="citation-title"
        className="mb-2 flex items-center system-xs-medium text-text-tertiary"
      >
        {citationTitle}
        <div className="ml-2 h-px grow bg-divider-regular" />
      </div>
      <div className="relative flex flex-wrap">
        {resources.map((res, index) => (
          <div
            key={`${res.sources[0]?.dataset_id}:${res.documentId}:${res.sources[0]?.document_version}`}
            aria-hidden
            data-testid="citation-measurement-item"
            className="absolute top-0 left-0 -z-10 mr-1 mb-1 h-7 w-auto max-w-60 pr-2 pl-7 text-xs whitespace-nowrap opacity-0"
            ref={(ele: HTMLDivElement | null) => {
              elesRef.current[index] = ele!
            }}
          >
            {res.documentName}
          </div>
        ))}
        {resources.slice(0, showMore ? resourcesLength : limitNumberInOneLine).map((res) => (
          <div
            key={`${res.sources[0]?.dataset_id}:${res.documentId}:${res.sources[0]?.document_version}`}
            className="mr-1 mb-1 cursor-pointer"
          >
            <Popup data={res} showHitInfo={showHitInfo} />
          </div>
        ))}
        {limitNumberInOneLine < resourcesLength && (
          <button
            type="button"
            aria-expanded={showMore}
            aria-label={citationToggleLabel}
            className="flex h-7 cursor-pointer appearance-none items-center rounded-lg bg-components-panel-bg px-2 system-xs-medium text-text-tertiary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
            onClick={() => setShowMore((v) => !v)}
          >
            {!showMore ? (
              `+ ${resourcesLength - limitNumberInOneLine}`
            ) : (
              <span
                aria-hidden
                className="i-ri-arrow-down-s-line size-4 rotate-180 text-text-tertiary"
              />
            )}
          </button>
        )}
      </div>
    </div>
  )
}

export default Citation
