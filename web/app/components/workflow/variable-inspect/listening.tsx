import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { RiStopLargeLine } from '@remixicon/react'
import Button from '@/app/components/base/button'
import BlockIcon from '@/app/components/workflow/block-icon'
import { BlockEnum } from '@/app/components/workflow/types'

export type ListeningProps = {
  onStop: () => void
  message?: string
}

const Listening: FC<ListeningProps> = ({
  onStop,
  message,
}) => {
  const { t } = useTranslation()

  return (
    <div className='flex h-full flex-col gap-4 rounded-xl bg-background-section p-8'>
      <div className='flex h-10 w-10 items-center justify-center rounded-[10px] border-[0.5px] bg-util-colors-blue-blue-500 shadow-lg backdrop-blur-sm'>
        <BlockIcon type={BlockEnum.TriggerWebhook} size="md" />
      </div>
      <div className='flex flex-col gap-1'>
        <div className='system-sm-semibold text-text-secondary'>{t('workflow.debug.variableInspect.listening.title')}</div>
        <div className='system-xs-regular text-text-tertiary'>{message ?? t('workflow.debug.variableInspect.listening.tip')}</div>
      </div>
      <div>
        <Button
          size='medium'
          className='px-3'
          variant='primary'
          onClick={onStop}
        >
          <RiStopLargeLine className='mr-1 size-4' />
          {t('workflow.debug.variableInspect.listening.stopButton')}
        </Button>
      </div>
    </div>
  )
}

export default Listening
