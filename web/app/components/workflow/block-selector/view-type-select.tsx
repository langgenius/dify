'use client'
import { SegmentedControl, SegmentedControlItem } from '@langgenius/dify-ui/segmented-control'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { ViewType } from './types'

type Props = Readonly<{
  viewType: ViewType
  onChange: (viewType: ViewType) => void
}>

function ViewTypeSelect({ viewType, onChange }: Props) {
  const { t } = useTranslation()

  const handleValueChange = (value: ViewType[]) => {
    const nextViewType = value[0]
    if (!nextViewType || nextViewType === viewType) return

    onChange(nextViewType)
  }

  return (
    <SegmentedControl<ViewType>
      value={[viewType]}
      aria-label={t(($) => $['operation.view'], { ns: 'common' })}
      className="gap-0 rounded-lg p-px"
      onValueChange={handleValueChange}
    >
      <SegmentedControlItem<ViewType>
        value={ViewType.flat}
        aria-label={t(($) => $['tabs.listView'], { ns: 'workflow' })}
        className="size-5.5 rounded-lg border-0 p-0 text-text-tertiary"
      >
        <span aria-hidden className="i-ri-sort-alphabet-asc size-4" />
      </SegmentedControlItem>
      <SegmentedControlItem<ViewType>
        value={ViewType.tree}
        aria-label={t(($) => $['tabs.treeView'], { ns: 'workflow' })}
        className="size-5.5 rounded-lg border-0 p-0 text-text-tertiary"
      >
        <span aria-hidden className="i-ri-node-tree size-4" />
      </SegmentedControlItem>
    </SegmentedControl>
  )
}
export default memo(ViewTypeSelect)
