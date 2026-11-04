'use client'

import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import UpgradeBtn from '@/app/components/billing/upgrade-btn'
import { deploymentEditionAtom } from '@/features/system-features/state'
import { consoleQuery } from '@/service/console'
import { DOCUMENT_UPLOAD_ACCEPT } from './policy'

const supportTypes = DOCUMENT_UPLOAD_ACCEPT.split(',')
  .map((extension) => extension.slice(1).toUpperCase())
  .join(', ')

export function DocumentUploadPlanNotice({ fileSizeLimitMb }: { fileSizeLimitMb: number }) {
  const { t } = useTranslation(['billing', 'datasetCreation'])
  const deploymentEdition = useAtomValue(deploymentEditionAtom)
  const { data: plan } = useQuery(
    consoleQuery.features.get.queryOptions({
      enabled: deploymentEdition === 'CLOUD',
      select: (data) => data.billing.subscription.plan,
    }),
  )
  if (deploymentEdition !== 'CLOUD' || plan !== 'sandbox') return null

  return (
    <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-components-panel-border-subtle bg-components-panel-on-panel-item-bg p-4">
      <div>
        <p className="system-sm-semibold text-text-primary">
          {t(($) => $['upgrade.uploadMultiplePages.title'], { ns: 'billing' })}
        </p>
        <p className="mt-1 system-xs-regular text-text-tertiary">
          {t(($) => $['stepOne.uploader.tip'], {
            ns: 'datasetCreation',
            supportTypes,
            size: fileSizeLimitMb,
            batchCount: 1,
          })}
        </p>
      </div>
      <UpgradeBtn
        size="s"
        isShort
        labelKey="triggerLimitModal.upgrade"
        loc="new-rag-upload-multiple-files"
      />
    </div>
  )
}
