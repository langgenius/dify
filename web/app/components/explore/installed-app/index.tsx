'use client'
import React, { FC, useEffect } from 'react'
import { App } from '@/types/app'
import ChatApp from '@/app/components/share/chat'

export interface IInstalledAppProps {
  id: string
}

const isMock = true
const appDetail = {
  "id": "4dcc2bac-0a48-4633-8e0b-0f4335669335",
  "name": "Interviewer",
  "mode": "chat",
  "icon": null,
  "icon_background": null,
  "app_model_config": {
      "opening_statement": null,
      "suggested_questions": [],
      "suggested_questions_after_answer": {
          "enabled": false
      },
      "more_like_this": {
          "enabled": false
      },
      "model": {
          "provider": "openai",
          "name": "gpt-3.5-turbo",
          "completion_params": {
              "max_tokens": 512,
              "temperature": 1,
              "top_p": 1,
              "presence_penalty": 0,
              "frequency_penalty": 0
          }
      },
      "user_input_form": [],
      "pre_prompt": null,
      "agent_mode": {
          "enabled": false,
          "tools": []
      }
  },
} as any

const InstalledApp: FC<IInstalledAppProps> = ({
  id,
}) => {
  const [app, setApp] = React.useState<App | null>(isMock ? appDetail : null)

  useEffect(() => {
    // TODO
    if(!isMock) {
      setApp(appDetail)
    }
  })
  return (
    <div className='h-full'>
      <ChatApp isInstalledApp installedAppInfo={appDetail}/>
    </div>
  )
}
export default React.memo(InstalledApp)
