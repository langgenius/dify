'use client'
import type { FC } from 'react'
import { RiSparklingFill } from '@remixicon/react'
import { noop } from 'es-toolkit/function'
import { useTranslation } from 'react-i18next'
import TextGeneration from '@/app/components/app/text-generate/item'
import { AppSourceType } from '@/service/share'
import GroupName from '../base/group-name'

type TextCompletionResultProps = {
  completionRes: string
  isResponding: boolean
  messageId: string | null
  isShowTextToSpeech?: boolean
}

const TextCompletionResult: FC<TextCompletionResultProps> = ({
  completionRes,
  isResponding,
  messageId,
  isShowTextToSpeech,
}) => {
  const { t } = useTranslation()

  if (!completionRes && !isResponding) {
    return (
      <div className="flex grow flex-col items-center justify-center gap-2">
        <RiSparklingFill className="h-12 w-12 text-text-empty-state-icon" />
        <div className="system-sm-regular text-text-quaternary">{t('noResult', { ns: 'appDebug' })}</div>
      </div>
    )
  }

  return (
    <>
      <div className="mx-4 mt-3">
        <GroupName name={t('result', { ns: 'appDebug' })} />
      </div>
      <div className="mx-3 mb-8">
        <TextGeneration
          appSourceType={AppSourceType.webApp}
          className="mt-2"
          content={completionRes}
          isLoading={!completionRes && isResponding}
          isShowTextToSpeech={isShowTextToSpeech}
          isResponding={isResponding}
          messageId={messageId}
          isError={false}
          onRetry={noop}
          siteInfo={null}
        />
      </div>
    </>
  )
}

export default TextCompletionResult
