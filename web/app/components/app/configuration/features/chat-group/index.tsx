'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import GroupName from '../../base/group-name'
import type { IOpeningStatementProps } from './opening-statement'
import OpeningStatement from './opening-statement'
import SuggestedQuestionsAfterAnswer from './suggested-questions-after-answer'
import SpeechToText from './speech-to-text'
import Citation from './citation'
import CacheReply from './cache-reply'
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
  isShowCitation: boolean
  isShowCacheReply: boolean
}
const ChatGroup: FC<ChatGroupProps> = ({
  isShowOpeningStatement,
  openingStatementConfig,
  isShowSuggestedQuestionsAfterAnswer,
  isShowSpeechText,
  isShowCitation,
  isShowCacheReply,
}) => {
  const { t } = useTranslation()

  return (
    <div className='mt-7'>
      <GroupName name={t('appDebug.feature.groupChat.title')} />
      <div className='space-y-3'>
        {isShowCacheReply && (
          <CacheReply />
        )}
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
        {
          isShowCitation && (
            <Citation />
          )
        }
      </div>
    </div>
  )
}
export default React.memo(ChatGroup)
