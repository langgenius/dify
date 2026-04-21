import type { DataSourceNotionPage, DataSourceNotionPageMap } from '@/models/common'
import { useTranslation } from 'react-i18next'
import { usePageSelectorModel } from '@/app/components/base/notion-page-selector/page-selector/use-page-selector-model'
import VirtualPageList from '@/app/components/base/notion-page-selector/page-selector/virtual-page-list'

type PageSelectorProps = {
  checkedIds: Set<string>
  disabledValue: Set<string>
  searchValue: string
  pagesMap: DataSourceNotionPageMap
  list: DataSourceNotionPage[]
  onSelect: (selectedPagesId: Set<string>) => void
  canPreview?: boolean
  onPreview?: (selectedPageId: string) => void
  isMultipleChoice?: boolean
  currentCredentialId?: string
}

const PageSelector = ({
  checkedIds,
  disabledValue,
  searchValue,
  pagesMap,
  list,
  onSelect,
  canPreview = true,
  onPreview,
  isMultipleChoice = true,
  currentCredentialId: _currentCredentialId,
}: PageSelectorProps) => {
  const { t } = useTranslation()
  const selectionMode = isMultipleChoice ? 'multiple' : 'single'
  const {
    currentPreviewPageId,
    effectiveSearchValue,
    rows,
    handlePreview,
    handleSelect,
    handleToggle,
  } = usePageSelectorModel({
    checkedIds,
    list,
    onPreview,
    onSelect,
    pagesMap,
    searchValue,
    selectionMode,
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
      checkedIds={checkedIds}
      disabledValue={disabledValue}
      onPreview={handlePreview}
      onSelect={handleSelect}
      onToggle={handleToggle}
      previewPageId={currentPreviewPageId}
      rows={rows}
      searchValue={effectiveSearchValue}
      selectionMode={selectionMode}
      showPreview={canPreview}
    />
  )
}

export default PageSelector
