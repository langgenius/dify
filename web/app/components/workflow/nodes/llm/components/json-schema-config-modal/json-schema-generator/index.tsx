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
import PromptEditor from './prompt-editor'
import GeneratedResult from './generated-result'
import { useGenerateStructuredOutputRules } from '@/service/use-common'
import Toast from '@/app/components/base/toast'
import { type FormValue, ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { useVisualEditorStore } from '../visual-editor/store'
import { useMittContext } from '../visual-editor/context'

type JsonSchemaGeneratorProps = {
  onApply: (schema: SchemaRoot) => void
  crossAxisOffset?: number
}

enum GeneratorView {
  promptEditor = 'promptEditor',
  result = 'result',
}

const JsonSchemaGenerator: FC<JsonSchemaGeneratorProps> = ({
  onApply,
  crossAxisOffset,
}) => {
  const localModel = localStorage.getItem('auto-gen-model')
    ? JSON.parse(localStorage.getItem('auto-gen-model') as string) as Model
    : null
  const [open, setOpen] = useState(false)
  const [view, setView] = useState(GeneratorView.promptEditor)
  const [model, setModel] = useState<Model>(localModel || {
    name: '',
    provider: '',
    mode: ModelModeType.completion,
    completion_params: {} as CompletionParams,
  })
  const [instruction, setInstruction] = useState('')
  const [schema, setSchema] = useState<SchemaRoot | null>(null)
  const { theme } = useTheme()
  const {
    defaultModel,
  } = useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.textGeneration)
  const advancedEditing = useVisualEditorStore(state => state.advancedEditing)
  const isAddingNewField = useVisualEditorStore(state => state.isAddingNewField)
  const { emit } = useMittContext()
  const SchemaGenerator = theme === Theme.light ? SchemaGeneratorLight : SchemaGeneratorDark

  useEffect(() => {
    if (defaultModel) {
      const localModel = localStorage.getItem('auto-gen-model')
        ? JSON.parse(localStorage.getItem('auto-gen-model') || '')
        : null
      if (localModel) {
        setModel(localModel)
      }
      else {
        setModel(prev => ({
          ...prev,
          name: defaultModel.model,
          provider: defaultModel.provider.provider,
        }))
      }
    }
  }, [defaultModel])

  const handleTrigger = useCallback((e: React.MouseEvent<HTMLElement, MouseEvent>) => {
    e.stopPropagation()
    if (advancedEditing || isAddingNewField)
      emit('quitEditing', {})
    setOpen(!open)
  }, [open, advancedEditing, isAddingNewField, emit])

  const onClose = useCallback(() => {
    setOpen(false)
  }, [])

  const handleModelChange = useCallback((newValue: { modelId: string; provider: string; mode?: string; features?: string[] }) => {
    const newModel = {
      ...model,
      provider: newValue.provider,
      name: newValue.modelId,
      mode: newValue.mode as ModelModeType,
    }
    setModel(newModel)
    localStorage.setItem('auto-gen-model', JSON.stringify(newModel))
  }, [model, setModel])

  const handleCompletionParamsChange = useCallback((newParams: FormValue) => {
    const newModel = {
      ...model,
      completion_params: newParams as CompletionParams,
    }
    setModel(newModel)
    localStorage.setItem('auto-gen-model', JSON.stringify(newModel))
  }, [model, setModel])

  const { mutateAsync: generateStructuredOutputRules, isPending: isGenerating } = useGenerateStructuredOutputRules()

  const generateSchema = useCallback(async () => {
    const { output, error } = await generateStructuredOutputRules({ instruction, model_config: model! })
    if (error) {
      Toast.notify({
        type: 'error',
        message: error,
      })
      setSchema(null)
      setView(GeneratorView.promptEditor)
      return
    }
    return output
  }, [instruction, model, generateStructuredOutputRules])

  const handleGenerate = useCallback(async () => {
    setView(GeneratorView.result)
    const output = await generateSchema()
    if (output === undefined) return
    setSchema(JSON.parse(output))
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
            'flex h-6 w-6 items-center justify-center rounded-md p-0.5 hover:bg-state-accent-hover',
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
            isGenerating={isGenerating}
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
