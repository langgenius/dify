import { useMemo } from 'react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import type { CitationItem } from '../type'
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
}
const Citation: FC<CitationProps> = ({
  data,
  showHitInfo,
}) => {
  const { t } = useTranslation()
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

  return (
    <div className='mt-3'>
      <div className='flex items-center mb-2 text-xs font-medium text-gray-500'>
        {t('common.chat.citation.title')}
        <div className='grow ml-2 h-[1px] bg-black/5' />
      </div>
      <div className='flex'>
        {
          resources.map((res, index) => (
            <Popup
              key={index}
              data={res}
              showHitInfo={showHitInfo}
            />
          ))
        }
      </div>
    </div>
  )
}

export default Citation
