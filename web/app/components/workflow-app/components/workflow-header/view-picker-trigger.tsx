'use client'

import { useQueryState } from 'nuqs'
import { useCallback } from 'react'
import { useFeatures } from '@/app/components/base/features/hooks'
import { ViewType } from '@/app/components/workflow/types'
import ViewPicker from '@/app/components/workflow/view-picker'
import { parseAsViewType, WORKFLOW_VIEW_PARAM_KEY } from '../../search-params'

const ViewPickerTrigger = () => {
  const isSupportSandbox = useFeatures(s => !!s.features.sandbox?.enabled)
  const [viewType, doSetViewType] = useQueryState(WORKFLOW_VIEW_PARAM_KEY, parseAsViewType)
  const handleViewTypeChange = useCallback((type: ViewType) => {
    doSetViewType(type)
  }, [doSetViewType])

  if (!isSupportSandbox)
    return null

  return (
    <ViewPicker
      value={viewType}
      onChange={handleViewTypeChange}
    />
  )
}

export default ViewPickerTrigger
