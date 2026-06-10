import type { GuideMethod } from '../../types'
import type { CreateGuideDslState } from '../dsl'
import type { App } from '@/types/app'

export function createDeploymentTargetQueryGate({
  dslReadError,
  dslState,
  effectiveSelectedApp,
  isReadingDsl,
  method,
}: {
  dslReadError: boolean
  dslState: CreateGuideDslState
  effectiveSelectedApp?: App
  isReadingDsl: boolean
  method: GuideMethod
}) {
  const shouldLoadSourceDeploymentOptions = method === 'bindApp' && Boolean(effectiveSelectedApp?.id)
  const shouldLoadDslDeploymentOptions = method === 'importDsl'
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
