import type { FC } from 'react'
import type { OnSend } from '../types'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Divider from '@/app/components/base/divider'

type TryToAskProps = {
  suggestedQuestions: string[]
  onSend: OnSend
}
const TryToAsk: FC<TryToAskProps> = ({
  suggestedQuestions,
  onSend,
}) => {
  const { t } = useTranslation()

  return (
    <div className="mb-2 py-2">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <Divider bgStyle="gradient" className="h-px !w-auto grow rotate-180" />
        <div className="system-xs-medium-uppercase shrink-0 text-text-tertiary">{t('feature.suggestedQuestionsAfterAnswer.tryToAsk', { ns: 'appDebug' })}</div>
        <Divider bgStyle="gradient" className="h-px !w-auto grow" />
      </div>
      <div className="flex flex-wrap justify-center">
        {
          suggestedQuestions.map((suggestQuestion, index) => (
            <Button
              size="small"
              key={index}
              variant="secondary-accent"
              className="mb-1 mr-1 last:mr-0"
              onClick={() => onSend(suggestQuestion)}
            >
              {suggestQuestion}
            </Button>
          ))
        }
      </div>
    </div>
  )
}

export default memo(TryToAsk)
