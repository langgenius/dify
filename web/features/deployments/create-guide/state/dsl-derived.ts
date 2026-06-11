import type { GuideMethod } from '../types'
import {
  dslAppName,
  encodeDslContent,
  isWorkflowDsl,
} from '@/features/deployments/dsl'

export type CreateGuideDslState = {
  dslDefaultAppName: string
  dslUnsupportedMode: boolean
  encodedDslContent: string
  hasDslContent: boolean
}

export function createDslState({
  dslContent,
  dslReadError,
  isReadingDsl,
  method,
}: {
  dslContent: string
  dslReadError: boolean
  isReadingDsl: boolean
  method: GuideMethod
}): CreateGuideDslState {
  const hasDslContent = Boolean(dslContent.trim())
  const dslUnsupportedMode = method === 'importDsl'
    && hasDslContent
    && !isReadingDsl
    && !dslReadError
    && !isWorkflowDsl(dslContent)

  return {
    dslDefaultAppName: dslContent ? dslAppName(dslContent) : '',
    dslUnsupportedMode,
    encodedDslContent: hasDslContent ? encodeDslContent(dslContent) : '',
    hasDslContent,
  }
}
