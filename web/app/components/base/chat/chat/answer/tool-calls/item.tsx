import type { ToolCallItem } from '../../type'
import {
  RiArrowDownSLine,
} from '@remixicon/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'

type ToolCallsItemProps = {
  payload: ToolCallItem
}
const ToolCallsItem = ({
  payload,
}: ToolCallsItemProps) => {
  const { t } = useTranslation()
  const [expand, setExpand] = useState(false)
  return (
    <div
      className="rounded-xl bg-background-gradient-bg-fill-chat-bubble-bg-1 px-2 pb-1 pt-2"
    >
      <div className="mb-1 flex cursor-pointer items-center hover:bg-background-gradient-bg-fill-chat-bubble-bg-2" onClick={() => setExpand(!expand)}>
        <div className="mr-1 h-5 w-5 grow truncate" title={payload.tool_name}>{payload.tool_name}</div>
        {
          !!payload.tool_elapsed_time && (
            <div className="system-xs-regular mr-1 shrink-0 text-text-tertiary">
              {payload.tool_elapsed_time?.toFixed(3)}
              s
            </div>
          )
        }
        <RiArrowDownSLine className="h-4 w-4 shrink-0" />
      </div>
      {
        expand && (
          <div className="relative px-2 pl-9">
            <div className="absolute bottom-1 left-2 top-1 w-[1px] bg-divider-regular"></div>
            {
              payload.is_thought && (
                <div className="body-sm-medium text-text-tertiary">{payload.tool_output}</div>
              )
            }
            {
              !payload.is_thought && (
                <CodeEditor
                  readOnly
                  title={<div>{t('common.input', { ns: 'workflow' })}</div>}
                  language={CodeLanguage.json}
                  value={JSON.parse(payload.tool_arguments || '{}')}
                  isJSONStringifyBeauty
                />
              )
            }
            {
              !payload.is_thought && (
                <CodeEditor
                  readOnly
                  className="mt-1"
                  title={<div>{t('common.output', { ns: 'workflow' })}</div>}
                  language={CodeLanguage.json}
                  value={{
                    answer: payload.tool_output,
                  }}
                  isJSONStringifyBeauty
                />
              )
            }
          </div>
        )
      }
    </div>
  )
}

export default ToolCallsItem
