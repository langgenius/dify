'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { useQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import GridMask from '@/app/components/base/grid-mask'
import { consoleQuery } from '@/service/console'
import UpgradeBtn from '../upgrade-btn'
import VectorSpaceInfo from '../usage-info/vector-space-info'
import s from './style.module.css'

const VectorSpaceFull: FC = () => {
  const { t } = useTranslation(['billing'])
  const { data: plan } = useQuery(
    consoleQuery.features.get.queryOptions({
      select: (features) => features.billing.subscription.plan,
    }),
  )
  const { data: vectorSpace, isPending: isVectorSpacePending } = useQuery(
    consoleQuery.features.vectorSpace.get.queryOptions(),
  )

  return (
    <GridMask
      wrapperClassName="border border-gray-200 rounded-xl"
      canvasClassName="rounded-xl"
      gradientClassName="rounded-xl"
    >
      <div className="px-6 py-5">
        <div className="flex items-center justify-between">
          <div className={cn(s.textGradient, 'text-base leading-6 font-semibold')}>
            <div>{t(($) => $['vectorSpace.fullTip'], { ns: 'billing' })}</div>
            <div>{t(($) => $['vectorSpace.fullSolution'], { ns: 'billing' })}</div>
          </div>
          <UpgradeBtn loc="knowledge-add-file" />
        </div>
        {plan && !isVectorSpacePending && (
          <VectorSpaceInfo
            className="pt-4"
            isSandboxPlan={plan === 'sandbox'}
            vectorSpace={vectorSpace}
          />
        )}
      </div>
    </GridMask>
  )
}
export default React.memo(VectorSpaceFull)
