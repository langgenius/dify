'use client'
import type { SimpleDocumentDetail } from '@/models/datasets'
import { cn } from '@langgenius/dify-ui/cn'
import {
  ComboboxItem,
  ComboboxItemText,
  ComboboxList,
} from '@langgenius/dify-ui/combobox'
import FileIcon from '../document-file-icon'

type Props = {
  className?: string
}

function getDocumentExtension(document: SimpleDocumentDetail) {
  const detailExtension = document.data_source_detail_dict?.upload_file?.extension
  if (detailExtension)
    return detailExtension

  const dataSourceInfo = document.data_source_info
  if (dataSourceInfo && 'upload_file' in dataSourceInfo)
    return dataSourceInfo.upload_file.extension

  return ''
}

export default function DocumentList({
  className,
}: Props) {
  return (
    <ComboboxList className={cn('max-h-[calc(100vh-120px)] p-0', className)}>
      {(item: SimpleDocumentDetail) => {
        const extension = getDocumentExtension(item)
        return (
          <ComboboxItem
            key={item.id}
            value={item}
            className="mx-0 flex h-8 grid-cols-none items-center gap-2 rounded-lg px-3 py-0"
          >
            <FileIcon name={item.name} extension={extension} size="lg" />
            <ComboboxItemText className="min-w-0 px-0 system-sm-regular text-text-secondary">
              {item.name}
            </ComboboxItemText>
          </ComboboxItem>
        )
      }}
    </ComboboxList>
  )
}
