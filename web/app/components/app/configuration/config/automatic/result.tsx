'use client'
import type { AlertDialogActions } from '@langgenius/dify-ui/alert-dialog'
import type { FC } from 'react'
import type { GenRes } from '@/service/debug'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import * as React from 'react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/components/app/configuration/toast'
import { CopyFeedback } from '@/app/components/base/copy-feedback'
import CodeEditor from '@/app/components/workflow/nodes/llm/components/json-schema-config-modal/code-editor'
import PromptRes from './prompt-res'
import PromptResInWorkflow from './prompt-res-in-workflow'
import PromptToast from './prompt-toast'
import { GeneratorType } from './types'
import VersionSelector from './version-selector'

type Props = Readonly<{
  isBasicMode?: boolean
  nodeId?: string
  current: GenRes
  currentVersionIndex: number
  setCurrentVersionIndex: (index: number) => void
  versions: GenRes[]
  onApply: () => void
  generatorType: GeneratorType
}>

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
  const { t } = useTranslation(['common', 'appGeneration'])
  const actionsRef = useRef<AlertDialogActions>(null)
  const isGeneratorPrompt = generatorType === GeneratorType.prompt

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-y-3">
        <div>
          <div className="shrink-0 text-base leading-[160%] font-semibold text-text-secondary">
            {t(($) => $['generate.resTitle'], { ns: 'appGeneration' })}
          </div>
          <VersionSelector
            versionLen={versions.length}
            value={currentVersionIndex}
            onChange={setCurrentVersionIndex}
          />
        </div>
        <div className="flex items-center space-x-2">
          <CopyFeedback
            content={current.modified}
            size="lg"
            variant="secondary"
            onCopyError={() => {
              toast.error(t(($) => $['operation.copyErrorFailed'], { ns: 'common' }))
            }}
          />
          <AlertDialog actionsRef={actionsRef}>
            <AlertDialogTrigger render={<Button variant="primary" />}>
              {t(($) => $['generate.apply'], { ns: 'appGeneration' })}
            </AlertDialogTrigger>
            <AlertDialogContent>
              <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
                <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
                  {isGeneratorPrompt
                    ? t(($) => $['generate.overwriteTitle'], { ns: 'appGeneration' })
                    : t(($) => $['codegen.overwriteConfirmTitle'], { ns: 'appGeneration' })}
                </AlertDialogTitle>
                <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
                  {isGeneratorPrompt
                    ? t(($) => $['generate.overwriteMessage'], { ns: 'appGeneration' })
                    : t(($) => $['codegen.overwriteConfirmMessage'], { ns: 'appGeneration' })}
                </AlertDialogDescription>
              </div>
              <AlertDialogFooter>
                <AlertDialogCancelButton>
                  {t(($) => $['operation.cancel'], { ns: 'common' })}
                </AlertDialogCancelButton>
                <AlertDialogConfirmButton
                  onClick={() => {
                    actionsRef.current?.close()
                    onApply()
                  }}
                >
                  {t(($) => $['operation.confirm'], { ns: 'common' })}
                </AlertDialogConfirmButton>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
      <div className="flex grow flex-col overflow-y-auto">
        {current?.message && <PromptToast message={current.message} className="mb-3 shrink-0" />}
        <div className="grow pb-6">
          {isGeneratorPrompt ? (
            isBasicMode ? (
              <PromptRes
                value={current?.modified}
                workflowVariableBlock={{
                  show: false,
                }}
              />
            ) : (
              <PromptResInWorkflow value={current?.modified || ''} nodeId={nodeId!} />
            )
          ) : (
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
