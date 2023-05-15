'use client'
import React, { FC } from 'react'
import GroupName from '../../base/group-name'
import OpeningStatement, { IOpeningStatementProps } from './opening-statement'
import SuggestedQuestionsAfterAnswer from './suggested-questions-after-answer'
import { useTranslation } from 'react-i18next'

/*
* Include 
* 1. Conversation Opener
* 2. Opening Suggestion
* 3. Next question suggestion
*/
interface ChatGroupProps {
  isShowOpeningStatement: boolean
  openingStatementConfig: IOpeningStatementProps
  isShowSuggestedQuestionsAfterAnswer: boolean
}
const ChatGroup: FC<ChatGroupProps> = ({
  isShowOpeningStatement,
  openingStatementConfig,
  isShowSuggestedQuestionsAfterAnswer
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
      </div>
    </div>
  )
}
export default React.memo(ChatGroup)
