'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import GroupName from '../../base/group-name'
import type { IOpeningStatementProps } from './opening-statement'
import OpeningStatement from './opening-statement'
import SuggestedQuestionsAfterAnswer from './suggested-questions-after-answer'
import SpeechToText from './speech-to-text'

/*
* Include
* 1. Conversation Opener
* 2. Opening Suggestion
* 3. Next question suggestion
*/
type ChatGroupProps = {
  isShowOpeningStatement: boolean
  openingStatementConfig: IOpeningStatementProps
  isShowSuggestedQuestionsAfterAnswer: boolean
  isShowSpeechText: boolean
}
const ChatGroup: FC<ChatGroupProps> = ({
  isShowOpeningStatement,
  openingStatementConfig,
  isShowSuggestedQuestionsAfterAnswer,
  isShowSpeechText,
}) => {
  const { t } = useTranslation()

  return (
    <div className='mt-7'>
      <GroupName name={t('appDebug.feature.groupChat.title')} />
      <div className='space-y-3'>
        {isShowOpeningStatement && (
          <OpeningStatement {...openingStatementConfig} />
        )}
        {isShowSuggestedQuestionsAfterAnswer && (
          <SuggestedQuestionsAfterAnswer />
        )}
        {
          isShowSpeechText && (
            <SpeechToText />
          )
        }
      </div>
    </div>
  )
}
export default React.memo(ChatGroup)
