import type { GuideMethod } from '../../types'
import type { CreateGuideDslState } from '../selectors'
import type { App } from '@/types/app'

export function createDeploymentTargetQueryGate({
  dslReadError,
  dslState,
  effectiveSelectedApp,
  isReadingDsl,
  method,
  shouldResolveDeploymentTarget,
}: {
  dslReadError: boolean
  dslState: CreateGuideDslState
  effectiveSelectedApp?: App
  isReadingDsl: boolean
  method: GuideMethod
  shouldResolveDeploymentTarget: boolean
}) {
  const shouldLoadSourceDeploymentOptions = shouldResolveDeploymentTarget && method === 'bindApp' && Boolean(effectiveSelectedApp?.id)
  const shouldLoadDslDeploymentOptions = shouldResolveDeploymentTarget
    && method === 'importDsl'
    && dslState.hasDslContent
    && !isReadingDsl
    && !dslReadError
    && !dslState.dslUnsupportedMode

  return {
    shouldLoadDeploymentTarget: shouldLoadSourceDeploymentOptions || shouldLoadDslDeploymentOptions,
    shouldLoadDslDeploymentOptions,
    shouldLoadSourceDeploymentOptions,
  }
}
