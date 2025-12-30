'use client'
import type { FC } from 'react'
import type { GenRes } from '@/service/debug'
import { RiClipboardLine } from '@remixicon/react'
import copy from 'copy-to-clipboard'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Toast from '@/app/components/base/toast'
import CodeEditor from '@/app/components/workflow/nodes/llm/components/json-schema-config-modal/code-editor'
import PromptRes from './prompt-res'
import PromptResInWorkflow from './prompt-res-in-workflow'
import PromptToast from './prompt-toast'
import { GeneratorType } from './types'
import VersionSelector from './version-selector'

type Props = {
  isBasicMode?: boolean
  nodeId?: string
  current: GenRes
  currentVersionIndex: number
  setCurrentVersionIndex: (index: number) => void
  versions: GenRes[]
  onApply: () => void
  generatorType: GeneratorType
}

const Result: FC<Props> = ({
  isBasicMode,
  nodeId,
  current,
  currentVersionIndex,
  setCurrentVersionIndex,
  versions,
  onApply,
  generatorType,
}) => {
  const { t } = useTranslation()
  const isGeneratorPrompt = generatorType === GeneratorType.prompt

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex shrink-0 items-center justify-between">
        <div>
          <div className="shrink-0 text-base font-semibold leading-[160%] text-text-secondary">{t('generate.resTitle', { ns: 'appDebug' })}</div>
          <VersionSelector
            versionLen={versions.length}
            value={currentVersionIndex}
            onChange={setCurrentVersionIndex}
          />
        </div>
        <div className="flex items-center space-x-2">
          <Button
            className="px-2"
            onClick={() => {
              copy(current.modified)
              Toast.notify({ type: 'success', message: t('actionMsg.copySuccessfully', { ns: 'common' }) })
            }}
          >
            <RiClipboardLine className="h-4 w-4 text-text-secondary" />
          </Button>
          <Button variant="primary" onClick={onApply}>
            {t('generate.apply', { ns: 'appDebug' })}
          </Button>
        </div>
      </div>
      <div className="flex grow flex-col overflow-y-auto">
        {
          current?.message && (
            <PromptToast message={current.message} className="mb-3 shrink-0" />
          )
        }
        <div className="grow pb-6">
          {isGeneratorPrompt
            ? (
                isBasicMode
                  ? (
                      <PromptRes
                        value={current?.modified}
                        workflowVariableBlock={{
                          show: false,
                        }}
                      />
                    )
                  : (
                      <PromptResInWorkflow
                        value={current?.modified || ''}
                        nodeId={nodeId!}
                      />
                    )
              )
            : (
                <CodeEditor
                  editorWrapperClassName="h-full"
                  className="bg-transparent pt-0"
                  value={current?.modified}
                  readOnly
                  hideTopMenu
                />
              )}
        </div>
      </div>
    </div>
  )
}
export default React.memo(Result)
