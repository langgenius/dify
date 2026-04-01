'use client'

import type { FC } from 'react'
import type { IAmplitudeProps } from './AmplitudeProvider'
import dynamic from '@/next/dynamic'

const AmplitudeProvider = dynamic(() => import('./AmplitudeProvider'), { ssr: false })

const LazyAmplitudeProvider: FC<IAmplitudeProps> = props => <AmplitudeProvider {...props} />

export default LazyAmplitudeProvider
