'use client'

import type { FC } from 'react'
import * as React from 'react'
import { AMPLITUDE_API_KEY, IS_CLOUD_EDITION } from '@/config'
import dynamic from '@/next/dynamic'

export type IAmplitudeProps = {
  sessionReplaySampleRate?: number
}

const AmplitudeSetup = dynamic(() => import('./amplitude-setup'), { ssr: false })

// Check if Amplitude should be enabled
export const isAmplitudeEnabled = () => {
  return IS_CLOUD_EDITION && !!AMPLITUDE_API_KEY
}

const AmplitudeProvider: FC<IAmplitudeProps> = ({
  sessionReplaySampleRate = 0.5,
}) => {
  if (!isAmplitudeEnabled())
    return null

  return <AmplitudeSetup sessionReplaySampleRate={sessionReplaySampleRate} />
}

export default React.memo(AmplitudeProvider)
