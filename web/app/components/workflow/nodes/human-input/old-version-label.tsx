import type { CommonNodeType } from '../../types'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import CornerLabel from '@/app/components/base/corner-label'
import { ENABLE_HITL_IM } from '@/config'
import { isLegacyHumanInputNodeData } from '../human-input-v2/migration/policy'

export function OldVersionLabel({
  data,
  compact = false,
}: {
  data: CommonNodeType
  compact?: boolean
}) {
  const { t } = useTranslation(['workflow'])
  if (!ENABLE_HITL_IM || !isLegacyHumanInputNodeData(data)) return null

  return (
    <CornerLabel
      label={t(($) => $['nodes.humanInputMigration.oldVersion'])}
      className="pointer-events-none absolute inset-e-0 top-0 overflow-hidden rounded-se-[15px] whitespace-nowrap"
      cornerClassName={cn(
        'text-util-colors-orange-orange-50 rtl:-scale-x-100',
        compact && 'h-4.25 w-2.75',
      )}
      labelClassName={cn('bg-util-colors-orange-orange-50', compact && 'pe-1.5 pt-0.75 pb-0.5')}
      textClassName="text-util-colors-orange-orange-600"
    />
  )
}
