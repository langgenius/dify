import React, { type FC, useCallback, useEffect, useState } from 'react'
import type { SchemaRoot } from '../../../types'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import useTheme from '@/hooks/use-theme'
import type { CompletionParams, Model } from '@/types/app'
import { ModelModeType } from '@/types/app'
import { Theme } from '@/types/app'
import { SchemaGeneratorDark, SchemaGeneratorLight } from './assets'
import cn from '@/utils/classnames'
import type { ModelInfo } from './prompt-editor'
import PromptEditor from './prompt-editor'
import GeneratedResult from './generated-result'
import { useGenerateStructuredOutputRules } from '@/service/use-common'
import Toast from '@/app/components/base/toast'
import { type FormValue, ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'

type JsonSchemaGeneratorProps = {
  onApply: (schema: SchemaRoot) => void
  crossAxisOffset?: number
}

enum GeneratorView {
  promptEditor = 'promptEditor',
  result = 'result',
}

export const JsonSchemaGenerator: FC<JsonSchemaGeneratorProps> = ({
  onApply,
  crossAxisOffset,
}) => {
  const [open, setOpen] = useState(false)
  const { theme } = useTheme()
  const [view, setView] = useState(GeneratorView.promptEditor)
  const [model, setModel] = useState<Model>({
    name: '',
    provider: '',
    mode: ModelModeType.completion,
    completion_params: {} as CompletionParams,
  })
  const [instruction, setInstruction] = useState('')
  const [schema, setSchema] = useState<SchemaRoot | null>(null)
  const SchemaGenerator = theme === Theme.light ? SchemaGeneratorLight : SchemaGeneratorDark
  const {
    defaultModel,
  } = useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.textGeneration)

  useEffect(() => {
    if (defaultModel) {
      setModel(prev => ({
        ...prev,
        name: defaultModel.model,
        provider: defaultModel.provider.provider,
      }))
    }
  }, [defaultModel])

  const handleTrigger = useCallback((e: React.MouseEvent<HTMLElement, MouseEvent>) => {
    e.stopPropagation()
    setOpen(!open)
  }, [open])

  const onClose = useCallback(() => {
    setOpen(false)
  }, [])

  const handleModelChange = useCallback((model: ModelInfo) => {
    setModel(prev => ({
      ...prev,
      provider: model.provider,
      name: model.modelId,
      mode: model.mode as ModelModeType,
    }))
  }, [])

  const handleCompletionParamsChange = useCallback((newParams: FormValue) => {
    setModel(prev => ({
      ...prev,
      completion_params: newParams as CompletionParams,
    }),
    )
  }, [])

  const { mutateAsync: generateStructuredOutputRules } = useGenerateStructuredOutputRules()

  const generateSchema = useCallback(async () => {
    const { output, error } = await generateStructuredOutputRules({ instruction, model_config: model! })
    if (error) {
      Toast.notify({
        type: 'error',
        message: error,
      })
      return
    }
    return output
  }, [instruction, model, generateStructuredOutputRules])

  const handleGenerate = useCallback(async () => {
    const output = await generateSchema()
    if (output === undefined) return
    setSchema(JSON.parse(output))
    setView(GeneratorView.result)
  }, [generateSchema])

  const goBackToPromptEditor = () => {
    setView(GeneratorView.promptEditor)
  }

  const handleRegenerate = useCallback(async () => {
    const output = await generateSchema()
    if (output === undefined) return
    setSchema(JSON.parse(output))
  }, [generateSchema])

  const handleApply = () => {
    onApply(schema!)
    setOpen(false)
  }

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-end'
      offset={{
        mainAxis: 4,
        crossAxis: crossAxisOffset ?? 0,
      }}
    >
      <PortalToFollowElemTrigger onClick={handleTrigger}>
        <button
          type='button'
          className={cn(
            'w-6 h-6 flex items-center justify-center p-0.5 rounded-md hover:bg-state-accent-hover',
            open && 'bg-state-accent-active',
          )}
        >
          <SchemaGenerator />
        </button>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-[100]'>
        {view === GeneratorView.promptEditor && (
          <PromptEditor
            instruction={instruction}
            model={model}
            onInstructionChange={setInstruction}
            onCompletionParamsChange={handleCompletionParamsChange}
            onGenerate={handleGenerate}
            onClose={onClose}
            onModelChange={handleModelChange}
          />
        )}
        {view === GeneratorView.result && (
          <GeneratedResult
            schema={schema!}
            onBack={goBackToPromptEditor}
            onRegenerate={handleRegenerate}
            onApply={handleApply}
            onClose={onClose}
          />
        )}
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default JsonSchemaGenerator
