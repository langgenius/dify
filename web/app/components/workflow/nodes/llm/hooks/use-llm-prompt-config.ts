import type { Draft } from 'immer'
import type { MutableRefObject } from 'react'
import type { LLMNodeType } from '../types'
import type {
  Memory,
  PromptItem,
  ValueSelector,
  Var,
  Variable,
} from '@/app/components/workflow/types'
import { produce } from 'immer'
import {
  useCallback,
  useMemo,
} from 'react'
import {
  checkHasContextBlock,
  checkHasHistoryBlock,
  checkHasQueryBlock,
} from '@/app/components/base/prompt-editor/constants'
import {
  EditionType,
  VarType,
} from '@/app/components/workflow/types'

type Params = {
  inputs: LLMNodeType
  inputRef: MutableRefObject<LLMNodeType>
  isChatMode: boolean
  isChatModel: boolean
  setInputs: (inputs: LLMNodeType) => void
}

const createPromptConfig = () => ({
  jinja2_variables: [] as Variable[],
})

const ensurePromptConfig = (draft: Draft<LLMNodeType>): { jinja2_variables: Variable[] } => {
  if (!draft.prompt_config)
    draft.prompt_config = createPromptConfig()

  if (!draft.prompt_config.jinja2_variables)
    draft.prompt_config.jinja2_variables = []

  return draft.prompt_config as { jinja2_variables: Variable[] }
}

const filterInputVar = (varPayload: Var) => {
  return [
    VarType.number,
    VarType.string,
    VarType.secret,
    VarType.arrayString,
    VarType.arrayNumber,
    VarType.file,
    VarType.arrayFile,
  ].includes(varPayload.type)
}

const filterJinja2InputVar = (varPayload: Var) => {
  return [
    VarType.number,
    VarType.string,
    VarType.secret,
    VarType.arrayString,
    VarType.arrayNumber,
    VarType.arrayBoolean,
    VarType.arrayObject,
    VarType.object,
    VarType.array,
    VarType.boolean,
  ].includes(varPayload.type)
}

const filterMemoryPromptVar = (varPayload: Var) => {
  return [
    VarType.arrayObject,
    VarType.array,
    VarType.number,
    VarType.string,
    VarType.secret,
    VarType.arrayString,
    VarType.arrayNumber,
    VarType.file,
    VarType.arrayFile,
  ].includes(varPayload.type)
}

const useLLMPromptConfig = ({
  inputs,
  inputRef,
  isChatMode,
  isChatModel,
  setInputs,
}: Params) => {
  const hasSetBlockStatus = useMemo(() => {
    const promptTemplate = inputs.prompt_template
    const hasSetContext = isChatModel
      ? (promptTemplate as PromptItem[]).some(item => checkHasContextBlock(item.text))
      : checkHasContextBlock((promptTemplate as PromptItem).text)

    if (!isChatMode) {
      return {
        history: false,
        query: false,
        context: hasSetContext,
      }
    }

    if (isChatModel) {
      return {
        history: false,
        query: (promptTemplate as PromptItem[]).some(item => checkHasQueryBlock(item.text)),
        context: hasSetContext,
      }
    }

    return {
      history: checkHasHistoryBlock((promptTemplate as PromptItem).text),
      query: checkHasQueryBlock((promptTemplate as PromptItem).text),
      context: hasSetContext,
    }
  }, [inputs.prompt_template, isChatMode, isChatModel])

  const shouldShowContextTip = !hasSetBlockStatus.context && inputs.context.enabled

  const isShowVars = useMemo(() => {
    if (isChatModel)
      return (inputs.prompt_template as PromptItem[]).some(item => item.edition_type === EditionType.jinja2)

    return (inputs.prompt_template as PromptItem).edition_type === EditionType.jinja2
  }, [inputs.prompt_template, isChatModel])

  const handleAddEmptyVariable = useCallback(() => {
    const nextInputs = produce(inputRef.current, (draft) => {
      const promptConfig = ensurePromptConfig(draft)
      promptConfig.jinja2_variables.push({
        variable: '',
        value_selector: [],
      })
    })
    setInputs(nextInputs)
  }, [inputRef, setInputs])

  const handleAddVariable = useCallback((payload: Variable) => {
    const nextInputs = produce(inputRef.current, (draft) => {
      const promptConfig = ensurePromptConfig(draft)
      promptConfig.jinja2_variables.push(payload)
    })
    setInputs(nextInputs)
  }, [inputRef, setInputs])

  const handleVarListChange = useCallback((newList: Variable[]) => {
    const nextInputs = produce(inputRef.current, (draft) => {
      const promptConfig = ensurePromptConfig(draft)
      promptConfig.jinja2_variables = newList
    })
    setInputs(nextInputs)
  }, [inputRef, setInputs])

  const handleVarNameChange = useCallback((oldName: string, newName: string) => {
    const nextInputs = produce(inputRef.current, (draft) => {
      if (isChatModel) {
        const promptTemplate = draft.prompt_template as PromptItem[]
        promptTemplate
          .filter(item => item.edition_type === EditionType.jinja2)
          .forEach((item) => {
            item.jinja2_text = (item.jinja2_text || '').replaceAll(`{{ ${oldName} }}`, `{{ ${newName} }}`)
          })
        return
      }

      const promptTemplate = draft.prompt_template as PromptItem
      if (promptTemplate.edition_type !== EditionType.jinja2)
        return

      promptTemplate.jinja2_text = (promptTemplate.jinja2_text || '').replaceAll(`{{ ${oldName} }}`, `{{ ${newName} }}`)
    })
    setInputs(nextInputs)
  }, [inputRef, isChatModel, setInputs])

  const handleContextVarChange = useCallback((newVar: ValueSelector | string) => {
    const nextInputs = produce(inputRef.current, (draft) => {
      draft.context.variable_selector = (newVar as ValueSelector) || []
      draft.context.enabled = !!(newVar && newVar.length > 0)
    })
    setInputs(nextInputs)
  }, [inputRef, setInputs])

  const handlePromptChange = useCallback((newPrompt: PromptItem[] | PromptItem) => {
    const nextInputs = produce(inputRef.current, (draft) => {
      draft.prompt_template = newPrompt
    })
    setInputs(nextInputs)
  }, [inputRef, setInputs])

  const handleMemoryChange = useCallback((newMemory?: Memory) => {
    const nextInputs = produce(inputRef.current, (draft) => {
      draft.memory = newMemory
    })
    setInputs(nextInputs)
  }, [inputRef, setInputs])

  const handleSyeQueryChange = useCallback((newQuery: string) => {
    const nextInputs = produce(inputRef.current, (draft) => {
      if (!draft.memory) {
        draft.memory = {
          window: {
            enabled: false,
            size: 10,
          },
          query_prompt_template: newQuery,
        }
        return
      }

      draft.memory.query_prompt_template = newQuery
    })
    setInputs(nextInputs)
  }, [inputRef, setInputs])

  return {
    hasSetBlockStatus,
    shouldShowContextTip,
    isShowVars,
    handleAddEmptyVariable,
    handleAddVariable,
    handleVarListChange,
    handleVarNameChange,
    handleContextVarChange,
    handlePromptChange,
    handleMemoryChange,
    handleSyeQueryChange,
    filterInputVar,
    filterJinja2InputVar,
    filterVar: filterMemoryPromptVar,
  }
}

export default useLLMPromptConfig
