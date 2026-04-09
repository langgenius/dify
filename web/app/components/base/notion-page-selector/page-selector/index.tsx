import type { DataSourceNotionPage, DataSourceNotionPageMap } from '@/models/common'
import { useTranslation } from 'react-i18next'
import { usePageSelectorModel } from './use-page-selector-model'
import VirtualPageList from './virtual-page-list'

type PageSelectorProps = {
  value: Set<string>
  disabledValue: Set<string>
  searchValue: string
  pagesMap: DataSourceNotionPageMap
  list: DataSourceNotionPage[]
  onSelect: (selectedPagesId: Set<string>) => void
  canPreview?: boolean
  previewPageId?: string
  onPreview?: (selectedPageId: string) => void
}

const PageSelector = ({
  value,
  disabledValue,
  searchValue,
  pagesMap,
  list,
  onSelect,
  canPreview = true,
  previewPageId,
  onPreview,
}: PageSelectorProps) => {
  const { t } = useTranslation()
  const {
    currentPreviewPageId,
    effectiveSearchValue,
    rows,
    handlePreview,
    handleSelect,
    handleToggle,
  } = usePageSelectorModel({
    checkedIds: value,
    list,
    onPreview,
    onSelect,
    pagesMap,
    previewPageId,
    searchValue,
    selectionMode: 'multiple',
  })

  if (!rows.length) {
    return (
      <div className="flex h-[296px] items-center justify-center text-[13px] text-text-tertiary">
        {t('dataSource.notion.selector.noSearchResult', { ns: 'common' })}
      </div>
    )
  }

  return (
    <VirtualPageList
      checkedIds={value}
      disabledValue={disabledValue}
      onPreview={handlePreview}
      onSelect={handleSelect}
      onToggle={handleToggle}
      previewPageId={currentPreviewPageId}
      rows={rows}
      searchValue={effectiveSearchValue}
      selectionMode="multiple"
      showPreview={canPreview}
    />
  )
}

export default PageSelector
