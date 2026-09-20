'use client'

import type { PropsWithChildren } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { useAtomValueRawSync } from 'jotai/react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import AppNotAccessible from './page'
import {
  appAccessStore,
  beginTrialAppAccess,
  endTrialAppAccess,
  trialAppAccessErrorAtom,
  trialAppAccessScopeAtom,
} from './state'

export default function TrialAppAccessBoundary({
  appId,
  onClose,
  children,
}: PropsWithChildren<{ appId: string; onClose: () => void }>) {
  const { t } = useTranslation('common')
  const scope = useAtomValueRawSync(trialAppAccessScopeAtom, { store: appAccessStore })
  const error = useAtomValueRawSync(trialAppAccessErrorAtom, { store: appAccessStore })
  useEffect(() => {
    const visit = beginTrialAppAccess(appId)
    return () => endTrialAppAccess(visit)
  }, [appId])

  if (!scope || scope.key !== `trial:${appId}`) return <Loading type="area" />
  if (error?.scope !== scope) return children
  return (
    <div className="relative h-full overflow-y-auto">
      <Button
        variant="tertiary"
        aria-label={t(($) => $['operation.close'])}
        className="absolute top-3 right-3 z-10"
        onClick={onClose}
      >
        <span aria-hidden className="i-ri-close-line size-5" />
      </Button>
      <div className="min-h-full pt-10">
        <AppNotAccessible embedded clientIp={error.clientIp} />
      </div>
    </div>
  )
}
