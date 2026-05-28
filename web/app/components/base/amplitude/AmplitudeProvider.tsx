'use client'

import type { FC } from 'react'
import type { AmplitudeInitializationOptions } from './init'
import * as React from 'react'
import { useEffect } from 'react'
import { ensureAmplitudeInitialized } from './init'

export type IAmplitudeProps = AmplitudeInitializationOptions

const AmplitudeProvider: FC<IAmplitudeProps> = ({
  sessionReplaySampleRate = 0.5,
}) => {
  useEffect(() => {
    ensureAmplitudeInitialized({
      sessionReplaySampleRate,
    })
  }, [sessionReplaySampleRate])

  // This is a client component that renders nothing
  return null
}

export default React.memo(AmplitudeProvider)
