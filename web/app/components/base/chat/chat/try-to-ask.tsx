import type { FC } from 'react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import type { OnSend } from '../types'
import Button from '@/app/components/base/button'
import Divider from '@/app/components/base/divider'
import cn from '@/utils/classnames'

type TryToAskProps = {
  suggestedQuestions: string[]
  onSend: OnSend
  isMobile?: boolean
}
const TryToAsk: FC<TryToAskProps> = ({
  suggestedQuestions,
  onSend,
  isMobile,
}) => {
  const { t } = useTranslation()

  return (
    <div className='mb-2 py-2'>
      <div className={cn('flex items-center justify-between gap-2 mb-2.5', isMobile && 'justify-end')}>
        <Divider bgStyle='gradient' className='grow h-px rotate-180' />
        <div className='shrink-0 text-text-tertiary system-xs-medium-uppercase'>{t('appDebug.feature.suggestedQuestionsAfterAnswer.tryToAsk')}</div>
        {!isMobile && <Divider bgStyle='gradient' className='grow h-px' />}
      </div>
      <div className={cn('flex flex-wrap justify-center', isMobile && 'justify-end')}>
        {
          suggestedQuestions.map((suggestQuestion, index) => (
            <Button
              size='small'
              key={index}
              variant='secondary-accent'
              className='mb-1 mr-1 last:mr-0'
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
