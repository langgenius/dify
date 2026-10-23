import type { PickerDocument } from '../../common/document-picker'
import type { ParentMode } from '@/models/datasets'
import { cn } from '@langgenius/dify-ui/cn'
import { useRouter } from '@/next/navigation'
import { DocumentPicker } from '../../common/document-picker'

type DocumentTitleProps = {
  datasetId: string
  document?: PickerDocument | null
  parentMode?: ParentMode
  wrapperCls?: string
}

export function DocumentTitle({ datasetId, document, parentMode, wrapperCls }: DocumentTitleProps) {
  const router = useRouter()

  return (
    <div className={cn('flex flex-1 items-center justify-start', wrapperCls)}>
      <DocumentPicker
        datasetId={datasetId}
        value={document}
        parentMode={parentMode}
        onChange={(doc) => {
          router.push(`/datasets/${datasetId}/documents/${doc.id}`)
        }}
      />
    </div>
  )
}
