import type { PlanFeatureExplanation } from '../../../../plan-feature-infotip'
import { InfotipTrigger } from '@langgenius/dify-ui/infotip'
import { useId } from 'react'

export function CloudPlanFeature({ label, description }: { label: string; description?: string }) {
  const labelId = useId()

  return (
    <li className="flex min-h-5 items-center gap-1.5 border-b border-(--pricing-feature-border) pb-0.5 text-sm leading-[17px]">
      <span
        aria-hidden
        className="h-[7px] w-1 flex-none pt-[3px] after:block after:size-1 after:rounded-full after:bg-text-accent"
      />
      <span id={labelId} className="min-w-0 flex-1 wrap-anywhere">
        {label}
      </span>
      {description && (
        <InfotipTrigger<PlanFeatureExplanation>
          aria-labelledby={labelId}
          payload={{ labelId, description }}
          iconVariant="information"
          iconSize="small"
          className="relative -m-1 size-[18px] text-(--pricing-info)"
        />
      )}
    </li>
  )
}
