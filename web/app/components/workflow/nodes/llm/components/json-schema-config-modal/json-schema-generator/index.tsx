import type { FC } from 'react'
import type { SchemaRoot } from '../../../types'
import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { CompletionParams, Model } from '@/types/app'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { toast } from '@langgenius/dify-ui/toast'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import useTheme from '@/hooks/use-theme'
import { useGenerateStructuredOutputRules } from '@/service/use-common'
import { ModelModeType, Theme } from '@/types/app'
import { useMittContext } from '../visual-editor/context'
import { useVisualEditorStore } from '../visual-editor/store'
import { SchemaGeneratorDark, SchemaGeneratorLight } from './assets'
import GeneratedResult from './generated-result'
import PromptEditor from './prompt-editor'

type JsonSchemaGeneratorProps = {
  onApply: (schema: SchemaRoot) => void
  crossAxisOffset?: number
}

const GENERATOR_VIEWS = {
  promptEditor: 'promptEditor',
  result: 'result',
} as const

type GeneratorView = typeof GENERATOR_VIEWS[keyof typeof GENERATOR_VIEWS]

const createEmptyModel = (): Model => ({
  name: '',
  provider: '',
  mode: ModelModeType.completion,
  completion_params: {} as CompletionParams,
})

const getStoredModel = (): Model | null => {
  if (typeof window === 'undefined')
    return null

  const savedModel = window.localStorage.getItem('auto-gen-model')

  if (!savedModel)
    return null

  return JSON.parse(savedModel) as Model
}

const JsonSchemaGenerator: FC<JsonSchemaGeneratorProps> = ({
  onApply,
  crossAxisOffset,
}) => {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<GeneratorView>(GENERATOR_VIEWS.promptEditor)
  const [model, setModel] = useState<Model | null>(() => getStoredModel())
  const [instruction, setInstruction] = useState('')
  const [schema, setSchema] = useState<SchemaRoot | null>(null)
  const { theme } = useTheme()
  const {
    defaultModel,
  } = useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.textGeneration)
  const resolvedModel = React.useMemo<Model>(() => {
    if (model)
      return model

    if (!defaultModel)
      return createEmptyModel()

    return {
      ...createEmptyModel(),
      name: defaultModel.model,
      provider: defaultModel.provider.provider,
    }
  }, [defaultModel, model])
  const advancedEditing = useVisualEditorStore(state => state.advancedEditing)
  const isAddingNewField = useVisualEditorStore(state => state.isAddingNewField)
  const { emit } = useMittContext()
  const SchemaGenerator = theme === Theme.light ? SchemaGeneratorLight : SchemaGeneratorDark

  const handleTrigger = useCallback((e: React.MouseEvent<HTMLElement, MouseEvent>) => {
    e.stopPropagation()
    if (advancedEditing || isAddingNewField)
      emit('quitEditing', {})
  }, [advancedEditing, isAddingNewField, emit])

  const onClose = useCallback(() => {
    setOpen(false)
  }, [])

  const handleModelChange = useCallback((newValue: { modelId: string, provider: string, mode?: string, features?: string[] }) => {
    const newModel = {
      ...resolvedModel,
      provider: newValue.provider,
      name: newValue.modelId,
      mode: newValue.mode as ModelModeType,
    }
    setModel(newModel)
    window.localStorage.setItem('auto-gen-model', JSON.stringify(newModel))
  }, [resolvedModel])

  const handleCompletionParamsChange = useCallback((newParams: FormValue) => {
    const newModel = {
      ...resolvedModel,
      completion_params: newParams as CompletionParams,
    }
    setModel(newModel)
    window.localStorage.setItem('auto-gen-model', JSON.stringify(newModel))
  }, [resolvedModel])

  const { mutateAsync: generateStructuredOutputRules, isPending: isGenerating } = useGenerateStructuredOutputRules()

  const generateSchema = useCallback(async () => {
    const { output, error } = await generateStructuredOutputRules({ instruction, model_config: resolvedModel })
    if (error) {
      toast.error(error)
      setSchema(null)
      setView(GENERATOR_VIEWS.promptEditor)
      return
    }
    return output
  }, [generateStructuredOutputRules, instruction, resolvedModel])

  const handleGenerate = useCallback(async () => {
    setView(GENERATOR_VIEWS.result)
    const output = await generateSchema()
    if (output === undefined)
      return
    setSchema(JSON.parse(output))
  }, [generateSchema])

  const goBackToPromptEditor = () => {
    setView(GENERATOR_VIEWS.promptEditor)
  }

  const handleRegenerate = useCallback(async () => {
    const output = await generateSchema()
    if (output === undefined)
      return
    setSchema(JSON.parse(output))
  }, [generateSchema])

  const handleApply = () => {
    onApply(schema!)
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
    >
      <PopoverTrigger
        render={(
          <button
            type="button"
            onClick={handleTrigger}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-md p-0.5 hover:bg-state-accent-hover',
              open && 'bg-state-accent-active',
            )}
          >
            <SchemaGenerator />
          </button>
        )}
      />
      <PopoverContent
        placement="bottom-end"
        sideOffset={4}
        alignOffset={crossAxisOffset ?? 0}
        popupClassName="border-none bg-transparent shadow-none"
      >
        {view === GENERATOR_VIEWS.promptEditor && (
          <PromptEditor
            instruction={instruction}
            model={resolvedModel}
            onInstructionChange={setInstruction}
            onCompletionParamsChange={handleCompletionParamsChange}
            onGenerate={handleGenerate}
            onClose={onClose}
            onModelChange={handleModelChange}
          />
        )}
        {view === GENERATOR_VIEWS.result && (
          <GeneratedResult
            schema={schema!}
            isGenerating={isGenerating}
            onBack={goBackToPromptEditor}
            onRegenerate={handleRegenerate}
            onApply={handleApply}
            onClose={onClose}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}

export default JsonSchemaGenerator
