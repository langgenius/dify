import type { FC } from 'react'
import type { ChunkingMode, ParentMode } from '@/models/datasets'
import { useRouter } from 'next/navigation'
import { cn } from '@/utils/classnames'
import DocumentPicker from '../../common/document-picker'

type DocumentTitleProps = {
  datasetId: string
  extension?: string
  name?: string
  chunkingMode?: ChunkingMode
  parent_mode?: ParentMode
  iconCls?: string
  textCls?: string
  wrapperCls?: string
}

export const DocumentTitle: FC<DocumentTitleProps> = ({
  datasetId,
  extension,
  name,
  chunkingMode,
  parent_mode,
  wrapperCls,
}) => {
  const router = useRouter()
  return (
    <div className={cn('flex flex-1 items-center justify-start', wrapperCls)}>
      <DocumentPicker
        datasetId={datasetId}
        value={{
          name,
          extension,
          chunkingMode,
          parentMode: parent_mode || 'paragraph',
        }}
        onChange={(doc) => {
          router.push(`/datasets/${datasetId}/documents/${doc.id}`)
        }}
      />
    </div>
  )
}
