import { useDebounceFn } from 'ahooks'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export type SegmentStatusFilterValue = 'all' | 0 | 1

export type SegmentStatusFilterOption = {
  value: SegmentStatusFilterValue
  name: string
}

type UseSearchFilterReturn = {
  inputValue: string
  searchValue: string
  selectedStatus: boolean | 'all'
  statusList: SegmentStatusFilterOption[]
  selectDefaultValue: SegmentStatusFilterValue
  handleInputChange: (value: string) => void
  onChangeStatus: (item: SegmentStatusFilterOption) => void
  onClearFilter: () => void
  resetPage: () => void
}

type UseSearchFilterOptions = {
  onPageChange: (page: number) => void
}

export const useSearchFilter = (options: UseSearchFilterOptions): UseSearchFilterReturn => {
  const { t } = useTranslation()
  const { onPageChange } = options

  const [inputValue, setInputValue] = useState<string>('')
  const [searchValue, setSearchValue] = useState<string>('')
  const [selectedStatus, setSelectedStatus] = useState<boolean | 'all'>('all')

  const statusList = useRef<SegmentStatusFilterOption[]>([
    { value: 'all', name: t($ => $['list.index.all'], { ns: 'datasetDocuments' }) },
    { value: 0, name: t($ => $['list.status.disabled'], { ns: 'datasetDocuments' }) },
    { value: 1, name: t($ => $['list.status.enabled'], { ns: 'datasetDocuments' }) },
  ])

  const { run: handleSearch } = useDebounceFn(() => {
    setSearchValue(inputValue)
    onPageChange(1)
  }, { wait: 500 })

  const handleInputChange = useCallback((value: string) => {
    setInputValue(value)
    handleSearch()
  }, [handleSearch])

  const onChangeStatus = useCallback(({ value }: SegmentStatusFilterOption) => {
    setSelectedStatus(value === 'all' ? 'all' : !!value)
    onPageChange(1)
  }, [onPageChange])

  const onClearFilter = useCallback(() => {
    setInputValue('')
    setSearchValue('')
    setSelectedStatus('all')
    onPageChange(1)
  }, [onPageChange])

  const resetPage = useCallback(() => {
    onPageChange(1)
  }, [onPageChange])

  const selectDefaultValue = useMemo(() => {
    if (selectedStatus === 'all')
      return 'all'
    return selectedStatus ? 1 : 0
  }, [selectedStatus])

  return {
    inputValue,
    searchValue,
    selectedStatus,
    statusList: statusList.current,
    selectDefaultValue,
    handleInputChange,
    onChangeStatus,
    onClearFilter,
    resetPage,
  }
}
