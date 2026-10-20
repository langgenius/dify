'use client'
import type { DocumentWithSegmentsResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { cn } from '@langgenius/dify-ui/cn'
import { ComboboxItem, ComboboxItemText, ComboboxList } from '@langgenius/dify-ui/combobox'
import { getUploadFileExtension } from '@/app/components/datasets/documents/document-source'
import FileIcon from '../document-file-icon'

type Props = Readonly<{
  className?: string
}>

function getDocumentExtension(document: DocumentWithSegmentsResponse) {
  const detailExtension = document.data_source_detail_dict?.upload_file?.extension
  if (detailExtension) return detailExtension

  return getUploadFileExtension(document.data_source_info) ?? ''
}

export default function DocumentList({ className }: Props) {
  return (
    <ComboboxList<DocumentWithSegmentsResponse>
      className={cn('max-h-[calc(100vh-120px)]', className)}
    >
      {(item) => {
        const extension = getDocumentExtension(item)
        return (
          <ComboboxItem
            key={item.id}
            value={item}
            className="flex h-8 grid-cols-none items-center gap-2 rounded-lg px-3 py-0"
          >
            <FileIcon name={item.name} extension={extension} size="lg" />
            <ComboboxItemText className="system-sm-regular text-text-secondary">
              {item.name}
            </ComboboxItemText>
          </ComboboxItem>
        )
      }}
    </ComboboxList>
  )
}
