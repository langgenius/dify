import type { ReactNode } from 'react'
import { Infotip, InfotipContent } from '@langgenius/dify-ui/infotip'

export type PlanFeatureExplanation = {
  labelId: string
  description: string
}

export function PlanFeatureInfotip({ children }: { children: ReactNode }) {
  return (
    <Infotip<PlanFeatureExplanation>>
      {({ payload }) => (
        <>
          {children}
          <InfotipContent
            aria-labelledby={payload?.labelId}
            className="max-w-80 whitespace-pre-wrap"
          >
            {payload?.description}
          </InfotipContent>
        </>
      )}
    </Infotip>
  )
}
