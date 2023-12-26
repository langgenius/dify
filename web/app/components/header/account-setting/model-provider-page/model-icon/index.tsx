import type { FC } from 'react'
import type { Model } from '../declarations'
import { ModelTypeEnum } from '../declarations'
import { useLanguage } from '../hooks'
import { useProviderContext } from '@/context/provider-context'

type ModelIconBaseProps = {
  provider?: Model
  className?: string
}
const ModelIconBase: FC<ModelIconBaseProps> = ({
  provider,
  className,
}) => {
  const language = useLanguage()

  if (provider?.icon_small) {
    return (
      <img
        alt='model-icon'
        src={`${provider.icon_small[language]}?_token=${localStorage.getItem('console_token')}`}
        className={`w-4 h-4 ${className}`}
      />
    )
  }

  return (
    <div className={`inline-flex items-center justify-center p-[1px] w-4 h-4 bg-[#D92D201F]/[0.12] rounded-[5px] ${className}`}>
      <div className='w-full h-full rounded-full bg-black/[0.24]' />
    </div>
  )
}

type ModelIconSubProps = {
  providerName: string
  className?: string
}
export const ModelIconTextGeneration: FC<ModelIconSubProps> = ({
  providerName,
  className,
}) => {
  const { textGenerationModelList } = useProviderContext()
  const provider = textGenerationModelList.find(item => item.provider === providerName)
  return (
    <ModelIconBase
      provider={provider!}
      className={className}
    />
  )
}

export const ModelIconTextEmbedding: FC<ModelIconSubProps> = ({
  providerName,
  className,
}) => {
  const { embeddingsModelList } = useProviderContext()
  const provider = embeddingsModelList.find(item => item.provider === providerName)
  return (
    <ModelIconBase
      provider={provider!}
      className={className}
    />
  )
}

export const ModelIconRerank: FC<ModelIconSubProps> = ({
  providerName,
  className,
}) => {
  const { rerankModelList } = useProviderContext()
  const provider = rerankModelList.find(item => item.provider === providerName)
  return (
    <ModelIconBase
      provider={provider!}
      className={className}
    />
  )
}

export const ModelIconSpeechToText: FC<ModelIconSubProps> = ({
  providerName,
  className,
}) => {
  const { speech2textModelList } = useProviderContext()
  const provider = speech2textModelList.find(item => item.provider === providerName)
  return (
    <ModelIconBase
      provider={provider!}
      className={className}
    />
  )
}

type ModelIconProps = {
  modelType: ModelTypeEnum
} & ModelIconSubProps
const ModelIcon: FC<ModelIconProps> = ({
  modelType,
  providerName,
  className,
}) => {
  if (modelType === ModelTypeEnum.textGeneration) {
    return (
      <ModelIconTextGeneration
        providerName={providerName}
        className={className}
      />
    )
  }
  if (modelType === ModelTypeEnum.textEmbedding) {
    return (
      <ModelIconTextEmbedding
        providerName={providerName}
        className={className}
      />
    )
  }
  if (modelType === ModelTypeEnum.rerank) {
    return (
      <ModelIconRerank
        providerName={providerName}
        className={className}
      />
    )
  }
  if (modelType === ModelTypeEnum.speech2text) {
    return (
      <ModelIconSpeechToText
        providerName={providerName}
        className={className}
      />
    )
  }

  return (
    <ModelIconBase
      className={className}
    />
  )
}

export default ModelIcon
