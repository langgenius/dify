import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import {
  AzureOpenaiServiceText,
  ChatglmText,
  HuggingfaceText,
  MinimaxText,
  ReplicateText,
  TongyiText,
} from '@/app/components/base/icons/src/public/llm'

const ICON_MAP = {
  azure_openai: <AzureOpenaiServiceText />,
  replicate: <ReplicateText />,
  huggingface_hub: <HuggingfaceText />,
  tongyi: <TongyiText />,
  minimax: <MinimaxText />,
  chatglm: <ChatglmText />,
}

type ModelItemProps = {
  type: string
  provider: string
  onOperate: () => void
}

const ModelItem: FC<ModelItemProps> = ({
  type,
  provider,
  onOperate,
}) => {
  const { t } = useTranslation()

  return (
    <div className='flex justify-between items-center mb-2 px-4 h-14 bg-gray-50 rounded-xl'>
      <div />
      <Button
        className='!px-3 !h-7 rounded-md bg-white !text-xs font-medium text-gray-700'
        onClick={onOperate}
      >
        {t(`common.operation.${type}`)}
      </Button>
    </div>
  )
}

export default ModelItem
