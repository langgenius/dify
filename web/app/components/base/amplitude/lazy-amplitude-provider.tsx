'use client'

import type { IAmplitudeProps } from './AmplitudeProvider'
import dynamic from '@/next/dynamic'

const AmplitudeProvider = dynamic(() => import('./AmplitudeProvider'), { ssr: false })

function LazyAmplitudeProvider(props: IAmplitudeProps) {
  return <AmplitudeProvider {...props} />
}

export default LazyAmplitudeProvider
