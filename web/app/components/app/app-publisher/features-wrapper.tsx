import React, { useCallback } from 'react'
import type { AppPublisherProps } from '@/app/components/app/app-publisher'
import AppPublisher from '@/app/components/app/app-publisher'
import { useFeatures } from '@/app/components/base/features/hooks'
import type { ModelAndParameter } from '@/app/components/app/configuration/debug/types'

type Props = Omit<AppPublisherProps, 'onPublish'> & {
  onPublish?: (modelAndParameter?: ModelAndParameter, features?: any) => Promise<any> | any
}

const FeaturesWrappedAppPublisher = (props: Props) => {
  const features = useFeatures(s => s.features)

  const handlePublish = useCallback((modelAndParameter?: ModelAndParameter) => {
    return props.onPublish?.(modelAndParameter, features)
  }, [features, props])

  return (
    <AppPublisher {...{
      ...props,
      onPublish: handlePublish,
    }}/>
  )
}

export default FeaturesWrappedAppPublisher
