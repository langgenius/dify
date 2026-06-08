'use client'

import type { UnsupportedDslNode } from '../error'
import type { GuideMethod, GuideStep } from './types'
import { useState } from 'react'

export function useDeploymentGuideProgress() {
  const [step, setStep] = useState<GuideStep>('source')
  const [method, setMethod] = useState<GuideMethod>('bindApp')
  const [submissionUnsupportedDslNodes, setSubmissionUnsupportedDslNodes] = useState<UnsupportedDslNode[]>([])

  function clearSubmissionUnsupportedDslNodes() {
    setSubmissionUnsupportedDslNodes([])
  }

  return {
    clearSubmissionUnsupportedDslNodes,
    method,
    setMethod,
    setStep,
    setSubmissionUnsupportedDslNodes,
    step,
    submissionUnsupportedDslNodes,
  }
}
