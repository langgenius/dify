import React, { type FC, useCallback, useState } from 'react'
import { type StructuredOutput, Type } from '../../../types'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import useTheme from '@/hooks/use-theme'
import { Theme } from '@/types/app'
import { SchemaGeneratorDark, SchemaGeneratorLight } from './assets'
import cn from '@/utils/classnames'
import PromptEditor from './prompt-editor'
import GeneratedResult from './generated-result'

type JsonSchemaGeneratorProps = {
  onApply: (schema: StructuredOutput) => void
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
  const [instruction, setInstruction] = useState('')
  const [schema, setSchema] = useState<StructuredOutput | null>(null)
  const SchemaGenerator = theme === Theme.light ? SchemaGeneratorLight : SchemaGeneratorDark

  const handleTrigger = useCallback((e: React.MouseEvent<HTMLElement, MouseEvent>) => {
    e.stopPropagation()
    setOpen(!open)
  }, [open])

  const onClose = useCallback(() => {
    setOpen(false)
  }, [])

  const generateSchema = useCallback(async () => {
    // todo: fetch schema, delete mock data
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        setSchema({
          schema: {
            type: Type.object,
            properties: {
              string_field_1: {
                type: Type.string,
                description: '可为空可为空可为空可为空可为空可为空可为空可为空可为空可为空',
              },
              string_field_2: {
                type: Type.string,
                description: '可为空可为空可为空可为空可为空可为空可为空可为空可为空可为空',
              },
            },
            required: [
              'string_field_1',
            ],
            additionalProperties: false,
          },
        })
        resolve()
      }, 1000)
    })
  }, [])

  const handleGenerate = useCallback(async () => {
    await generateSchema()
    setView(GeneratorView.result)
  }, [generateSchema])

  const goBackToPromptEditor = () => {
    setView(GeneratorView.promptEditor)
  }

  const handleRegenerate = useCallback(async () => {
    await generateSchema()
  }, [generateSchema])

  const handleApply = () => {
    onApply(schema!)
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
            onInstructionChange={setInstruction}
            onGenerate={handleGenerate}
            onClose={onClose}
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
