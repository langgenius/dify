import type { ChangeEvent, FC, FormEvent } from 'react'
import type { InputValueTypes } from '../types'
import type { PromptConfig } from '@/models/debug'
import type { SiteInfo } from '@/models/share'
import type { VisionFile, VisionSettings } from '@/types/app'
import {
  RiLoader2Line,
  RiPlayLargeLine,
} from '@remixicon/react'
import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { FileUploaderInAttachmentWrapper } from '@/app/components/base/file-uploader'
import { StopCircle } from '@/app/components/base/icons/src/vender/solid/mediaAndDevices'
import TextGenerationImageUploader from '@/app/components/base/image-uploader/text-generation-image-uploader'
import Input from '@/app/components/base/input'
import Select from '@/app/components/base/select'
import Textarea from '@/app/components/base/textarea'
import BoolInput from '@/app/components/workflow/nodes/_base/components/before-run-form/bool-input'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { cn } from '@/utils/classnames'

export type IRunOnceProps = {
  siteInfo: SiteInfo
  promptConfig: PromptConfig
  inputs: Record<string, InputValueTypes>
  inputsRef: React.RefObject<Record<string, InputValueTypes>>
  onInputsChange: (inputs: Record<string, InputValueTypes>) => void
  onSend: () => void
  visionConfig: VisionSettings
  onVisionFilesChange: (files: VisionFile[]) => void
  runControl?: {
    onStop: () => Promise<void> | void
    isStopping: boolean
  } | null
}
const RunOnce: FC<IRunOnceProps> = ({
  promptConfig,
  inputs,
  inputsRef,
  onInputsChange,
  onSend,
  visionConfig,
  onVisionFilesChange,
  runControl,
}) => {
  const { t } = useTranslation()
  const media = useBreakpoints()
  const isPC = media === MediaType.pc
  const [isInitialized, setIsInitialized] = useState(false)

  const onClear = () => {
    const newInputs: Record<string, InputValueTypes> = {}
    promptConfig.prompt_variables.forEach((item) => {
      if (item.type === 'string' || item.type === 'paragraph')
        newInputs[item.key] = ''
      else if (item.type === 'number')
        newInputs[item.key] = ''
      else if (item.type === 'checkbox')
        newInputs[item.key] = false
      else
        newInputs[item.key] = undefined
    })
    onInputsChange(newInputs)
  }

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    onSend()
  }
  const isRunning = !!runControl
  const stopLabel = t('generation.stopRun', { ns: 'share', defaultValue: 'Stop Run' })
  const handlePrimaryClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    if (!isRunning)
      return
    e.preventDefault()
    runControl?.onStop?.()
  }, [isRunning, runControl])

  const handleInputsChange = useCallback((newInputs: Record<string, any>) => {
    onInputsChange(newInputs)
    inputsRef.current = newInputs
  }, [onInputsChange, inputsRef])

  useEffect(() => {
    if (isInitialized)
      return
    const newInputs: Record<string, any> = {}
    promptConfig.prompt_variables.forEach((item) => {
      if (item.type === 'select')
        newInputs[item.key] = item.default
      else if (item.type === 'string' || item.type === 'paragraph')
        newInputs[item.key] = item.default || ''
      else if (item.type === 'number')
        newInputs[item.key] = item.default ?? ''
      else if (item.type === 'checkbox')
        newInputs[item.key] = item.default || false
      else if (item.type === 'file')
        newInputs[item.key] = undefined
      else if (item.type === 'file-list')
        newInputs[item.key] = []
      else
        newInputs[item.key] = undefined
    })
    onInputsChange(newInputs)
    setIsInitialized(true)
  }, [promptConfig.prompt_variables, onInputsChange])

  return (
    <div className="">
      <section>
        {/* input form */}
        <form onSubmit={onSubmit}>
          {(inputs === null || inputs === undefined || Object.keys(inputs).length === 0) || !isInitialized
            ? null
            : promptConfig.prompt_variables.filter(item => item.hide !== true).map(item => (
                <div className="mt-4 w-full" key={item.key}>
                  {item.type !== 'checkbox' && (
                    <div className="system-md-semibold flex h-6 items-center gap-1 text-text-secondary">
                      <div className="truncate">{item.name}</div>
                      {!item.required && <span className="system-xs-regular text-text-tertiary">{t('panel.optional', { ns: 'workflow' })}</span>}
                    </div>
                  )}
                  <div className="mt-1">
                    {item.type === 'select' && (
                      <Select
                        className="w-full"
                        defaultValue={inputs[item.key] as (string | number | undefined)}
                        onSelect={(i) => { handleInputsChange({ ...inputsRef.current, [item.key]: i.value }) }}
                        items={(item.options || []).map(i => ({ name: i, value: i }))}
                        allowSearch={false}
                      />
                    )}
                    {item.type === 'string' && (
                      <Input
                        type="text"
                        placeholder={item.name}
                        value={inputs[item.key] as string}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => { handleInputsChange({ ...inputsRef.current, [item.key]: e.target.value }) }}
                        maxLength={item.max_length}
                      />
                    )}
                    {item.type === 'paragraph' && (
                      <Textarea
                        className="h-[104px] sm:text-xs"
                        placeholder={item.name}
                        value={inputs[item.key] as string}
                        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => { handleInputsChange({ ...inputsRef.current, [item.key]: e.target.value }) }}
                      />
                    )}
                    {item.type === 'number' && (
                      <Input
                        type="number"
                        placeholder={item.name}
                        value={inputs[item.key] as number}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => { handleInputsChange({ ...inputsRef.current, [item.key]: e.target.value }) }}
                      />
                    )}
                    {item.type === 'checkbox' && (
                      <BoolInput
                        name={item.name || item.key}
                        value={!!inputs[item.key] as boolean}
                        required={item.required}
                        onChange={(value) => { handleInputsChange({ ...inputsRef.current, [item.key]: value }) }}
                      />
                    )}
                    {item.type === 'file' && (
                      <FileUploaderInAttachmentWrapper
                        value={(inputs[item.key] && typeof inputs[item.key] === 'object') ? [inputs[item.key]] : []}
                        onChange={(files) => { handleInputsChange({ ...inputsRef.current, [item.key]: files[0] }) }}
                        fileConfig={{
                          ...item.config,
                          fileUploadConfig: (visionConfig as any).fileUploadConfig,
                        }}
                      />
                    )}
                    {item.type === 'file-list' && (
                      <FileUploaderInAttachmentWrapper
                        value={Array.isArray(inputs[item.key]) ? inputs[item.key] : []}
                        onChange={(files) => { handleInputsChange({ ...inputsRef.current, [item.key]: files }) }}
                        fileConfig={{
                          ...item.config,
                          // eslint-disable-next-line ts/no-explicit-any
                          fileUploadConfig: (visionConfig as any).fileUploadConfig,
                        }}
                      />
                    )}
                    {item.type === 'json_object' && (
                      <CodeEditor
                        language={CodeLanguage.json}
                        value={inputs[item.key] as string}
                        onChange={(value) => { handleInputsChange({ ...inputsRef.current, [item.key]: value }) }}
                        noWrapper
                        className="bg h-[80px] overflow-y-auto rounded-[10px] bg-components-input-bg-normal p-1"
                        placeholder={
                          <div className="whitespace-pre">{typeof item.json_schema === 'string' ? item.json_schema : JSON.stringify(item.json_schema || '', null, 2)}</div>
                        }
                      />
                    )}
                  </div>
                </div>
              ))}
          {
            visionConfig?.enabled && (
              <div className="mt-4 w-full">
                <div className="system-md-semibold flex h-6 items-center text-text-secondary">{t('imageUploader.imageUpload', { ns: 'common' })}</div>
                <div className="mt-1">
                  <TextGenerationImageUploader
                    settings={visionConfig}
                    onFilesChange={files => onVisionFilesChange(files.filter(file => file.progress !== -1).map(fileItem => ({
                      type: 'image',
                      transfer_method: fileItem.type,
                      url: fileItem.url,
                      upload_file_id: fileItem.fileId,
                    })))}
                  />
                </div>
              </div>
            )
          }
          <div className="mb-3 mt-6 w-full">
            <div className="flex items-center justify-between gap-2">
              <Button
                onClick={onClear}
                disabled={false}
              >
                <span className="text-[13px]">{t('operation.clear', { ns: 'common' })}</span>
              </Button>
              <Button
                className={cn(!isPC && 'grow')}
                type={isRunning ? 'button' : 'submit'}
                variant={isRunning ? 'secondary' : 'primary'}
                disabled={isRunning && runControl?.isStopping}
                onClick={handlePrimaryClick}
                data-testid={isRunning ? 'stop-button' : 'run-button'}
              >
                {isRunning
                  ? (
                      <>
                        {runControl?.isStopping
                          ? <RiLoader2Line className="mr-1 h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
                          : <StopCircle className="mr-1 h-4 w-4 shrink-0" aria-hidden="true" />}
                        <span className="text-[13px]">{stopLabel}</span>
                      </>
                    )
                  : (
                      <>
                        <RiPlayLargeLine className="mr-1 h-4 w-4 shrink-0" aria-hidden="true" />
                        <span className="text-[13px]">{t('generation.run', { ns: 'share' })}</span>
                      </>
                    )}
              </Button>
            </div>
          </div>
        </form>
      </section>
    </div>
  )
}
export default React.memo(RunOnce)
