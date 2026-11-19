import type { DecisionGenerateResponse } from '@dify/contracts/api/console/decision-generate/types.gen'
import type { Var, Variable } from '../../types'
import type { Condition, LogicalOperator } from '../if-else/types'
import type { DecisionNodeType, ExtraSource, Outcome, RuleGroup } from './types'
import type { ModelConfig } from '@/app/components/workflow/types'
import { useMutation } from '@tanstack/react-query'
import { cloneDeep } from 'es-toolkit/object'
import { produce } from 'immer'
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useUpdateNodeInternals } from 'reactflow'
import { v4 as uuid4 } from 'uuid'
import { useLocale } from '#i18n'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { useEdgesInteractions } from '@/app/components/workflow/hooks/use-edges-interactions'
import { useNodesReadOnly, useWorkflow } from '@/app/components/workflow/hooks/use-workflow'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import { getVarsIsVarFileAttribute } from '@/app/components/workflow/nodes/if-else/use-config.helpers'
import useIsVarFileAttribute from '@/app/components/workflow/nodes/if-else/use-is-var-file-attribute'
import { getOperators } from '@/app/components/workflow/nodes/if-else/utils'
import { consoleQuery } from '@/service/console'
import { VarType } from '../../types'
import { DecideBy, genDefaultRuleGroup, genOutcomeId, OTHERWISE_HANDLE_ID } from './types'
import {
  getExtraNameError,
  hasRulesToLose,
  toGeneratedDecision,
  toGeneratorVariables,
} from './utils'

const filterAllVars = () => true

const filterNumberVars = (varPayload: Var) => varPayload.type === VarType.number

// The generator only needs enough context to pick selectors; a large workflow
// can offer thousands of variables, so the request carries a bounded slice.
const MAX_AVAILABLE_VARIABLES = 200

// What the panel shows under the sentence after a generate attempt. `noModel`
// is a local precondition; `error` carries the server's or transport's message.
export type GenerateFeedback = { kind: 'noModel' } | { kind: 'error'; message: string } | null

// Outcome ids double as source handle ids, so the If-Else condition editor,
// which addresses a rule group as a "case", can use the outcome id as case id.
const toCaseItemView = (outcome: Outcome) => {
  const when =
    typeof outcome.when === 'object' && outcome.when !== null ? outcome.when : genDefaultRuleGroup()

  return {
    case_id: outcome.id,
    logical_operator: when.logical_operator as LogicalOperator,
    conditions: when.conditions,
  }
}

const syncTargetBranches = (draft: DecisionNodeType) => {
  draft._targetBranches = [
    ...draft.outcomes.map((outcome) => ({
      id: outcome.id,
      name: outcome.label,
    })),
    {
      id: OTHERWISE_HANDLE_ID,
      name: draft.otherwise?.label ?? '',
    },
  ]
}

const useConfig = (id: string, payload: DecisionNodeType) => {
  const updateNodeInternals = useUpdateNodeInternals()
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const { handleEdgeDeleteByDeleteBranch } = useEdgesInteractions()
  const { handleOutVarRenameChange, isVarUsedInNodes, removeUsedVarInNodes } = useWorkflow()
  const locale = useLocale()
  const { inputs, setInputs: doSetInputs } = useNodeCrud<DecisionNodeType>(id, payload)
  const inputsRef = useRef(inputs)
  const setInputs = useCallback(
    (newInputs: DecisionNodeType) => {
      inputsRef.current = newInputs
      doSetInputs(newInputs)
    },
    [doSetInputs],
  )
  useEffect(() => {
    inputsRef.current = inputs
  }, [inputs])

  // The panel this hook serves is keyed by node id: switching nodes unmounts
  // it. A generate response can land after that; only the node the request
  // was made for may receive it, so the current identity is tracked here.
  const panelNodeIdRef = useRef<string | null>(id)
  useEffect(() => {
    panelNodeIdRef.current = id
    return () => {
      panelNodeIdRef.current = null
    }
  }, [id])

  // Per-outcome memory of the `when` value each mode last had. Lives only for
  // the panel lifetime and is never persisted into node data.
  const whenStashRef = useRef<Record<string, { rules?: RuleGroup; llm?: string }>>({})

  // Stable keys for rendering extras without adding ids to node data. Kept
  // for the panel lifetime only; the whole list is rebuilt if it ever goes
  // out of sync with the extras (undo/redo, generated configurations).
  const [extraKeys, setExtraKeys] = useState<string[]>(() => inputs.extras.map(() => uuid4()))
  if (extraKeys.length !== inputs.extras.length) setExtraKeys(inputs.extras.map(() => uuid4()))

  const filterVar = useCallback(() => filterAllVars(), [])

  const { availableVars, availableNodesWithParent } = useAvailableVarList(id, {
    onlyLeafNodeVar: false,
    filterVar,
  })

  const filterNumberVar = useCallback((varPayload: Var) => filterNumberVars(varPayload), [])

  const { getIsVarFileAttribute } = useIsVarFileAttribute({
    nodeId: id,
    isInIteration: !!payload.isInIteration,
    isInLoop: !!payload.isInLoop,
  })

  const varsIsVarFileAttribute = getVarsIsVarFileAttribute(
    inputs.outcomes.map(toCaseItemView),
    getIsVarFileAttribute,
  )

  const isRulesMode = inputs.decide_by === DecideBy.rules

  const handleIntentChange = useCallback(
    (intent: string) => {
      const newInputs = produce(inputsRef.current, (draft) => {
        draft.intent = intent
      })
      setInputs(newInputs)
    },
    [setInputs],
  )

  const handleDecideByChange = useCallback(
    (nextDecideBy: DecideBy) => {
      const currentDecideBy = inputsRef.current.decide_by
      if (nextDecideBy === currentDecideBy || nextDecideBy === DecideBy.decisionModel) return

      const whenStash = whenStashRef.current
      const newInputs = produce(inputsRef.current, (draft) => {
        draft.outcomes.forEach((outcome) => {
          whenStash[outcome.id] = {
            ...whenStash[outcome.id],
            // copy out of the immer draft; the stash outlives this produce call
            [currentDecideBy]: cloneDeep(outcome.when),
          }
          const stashed = whenStash[outcome.id]?.[nextDecideBy]
          outcome.when =
            stashed !== undefined
              ? stashed
              : nextDecideBy === DecideBy.rules
                ? genDefaultRuleGroup()
                : ''
        })
        draft.decide_by = nextDecideBy
        if (nextDecideBy === DecideBy.llm && !draft.model)
          draft.model = {
            provider: '',
            name: '',
            mode: 'chat',
            completion_params: {},
          }
      })
      setInputs(newInputs)
    },
    [setInputs],
  )

  const handleAddOutcome = useCallback(() => {
    const newInputs = produce(inputsRef.current, (draft) => {
      draft.outcomes.push({
        id: genOutcomeId(),
        label: '',
        when: isRulesMode ? genDefaultRuleGroup() : '',
      })
      syncTargetBranches(draft)
    })
    setInputs(newInputs)
    updateNodeInternals(id)
  }, [id, isRulesMode, setInputs, updateNodeInternals])

  const handleRemoveOutcome = useCallback(
    (outcomeId: string) => {
      handleEdgeDeleteByDeleteBranch(id, outcomeId)
      const newInputs = produce(inputsRef.current, (draft) => {
        draft.outcomes = draft.outcomes.filter((outcome) => outcome.id !== outcomeId)
        // A removed outcome has no result to give a fixed extra value for.
        draft.extras.forEach((extra) => {
          if (extra.values) delete extra.values[outcomeId]
        })
        syncTargetBranches(draft)
      })
      setInputs(newInputs)
      updateNodeInternals(id)
    },
    [handleEdgeDeleteByDeleteBranch, id, setInputs, updateNodeInternals],
  )

  const handleUpdateOutcomeLabel = useCallback(
    (outcomeId: string, label: string) => {
      const newInputs = produce(inputsRef.current, (draft) => {
        const outcome = draft.outcomes.find((outcome) => outcome.id === outcomeId)
        if (outcome) outcome.label = label
        syncTargetBranches(draft)
      })
      setInputs(newInputs)
    },
    [setInputs],
  )

  const handleUpdateOutcomeWhenText = useCallback(
    (outcomeId: string, when: string) => {
      const newInputs = produce(inputsRef.current, (draft) => {
        const outcome = draft.outcomes.find((outcome) => outcome.id === outcomeId)
        if (outcome) outcome.when = when
      })
      setInputs(newInputs)
    },
    [setInputs],
  )

  const handleOtherwiseLabelChange = useCallback(
    (label: string) => {
      const newInputs = produce(inputsRef.current, (draft) => {
        draft.otherwise.label = label
        syncTargetBranches(draft)
      })
      setInputs(newInputs)
    },
    [setInputs],
  )

  const handleAddCondition = useCallback(
    (outcomeId: string, valueSelector: string[], variable: Var) => {
      const newInputs = produce(inputsRef.current, (draft) => {
        const outcome = draft.outcomes.find((outcome) => outcome.id === outcomeId)
        if (!outcome || typeof outcome.when !== 'object' || outcome.when === null) return

        outcome.when.conditions.push({
          id: uuid4(),
          varType: variable.type,
          variable_selector: valueSelector,
          comparison_operator: getOperators(
            variable.type,
            getIsVarFileAttribute(valueSelector) ? { key: valueSelector.slice(-1)[0]! } : undefined,
          )[0],
          value:
            variable.type === VarType.boolean || variable.type === VarType.arrayBoolean
              ? false
              : '',
        })
      })
      setInputs(newInputs)
    },
    [getIsVarFileAttribute, setInputs],
  )

  const handleRemoveCondition = useCallback(
    (outcomeId: string, conditionId: string) => {
      const newInputs = produce(inputsRef.current, (draft) => {
        const outcome = draft.outcomes.find((outcome) => outcome.id === outcomeId)
        if (!outcome || typeof outcome.when !== 'object' || outcome.when === null) return

        outcome.when.conditions = outcome.when.conditions.filter(
          (condition) => condition.id !== conditionId,
        )
      })
      setInputs(newInputs)
    },
    [setInputs],
  )

  const handleUpdateCondition = useCallback(
    (outcomeId: string, conditionId: string, nextCondition: Condition) => {
      const newInputs = produce(inputsRef.current, (draft) => {
        const outcome = draft.outcomes.find((outcome) => outcome.id === outcomeId)
        if (!outcome || typeof outcome.when !== 'object' || outcome.when === null) return

        const targetCondition = outcome.when.conditions.find(
          (condition) => condition.id === conditionId,
        )
        if (targetCondition) Object.assign(targetCondition, nextCondition)
      })
      setInputs(newInputs)
    },
    [setInputs],
  )

  const handleToggleConditionLogicalOperator = useCallback(
    (outcomeId: string) => {
      const newInputs = produce(inputsRef.current, (draft) => {
        const outcome = draft.outcomes.find((outcome) => outcome.id === outcomeId)
        if (!outcome || typeof outcome.when !== 'object' || outcome.when === null) return

        outcome.when.logical_operator =
          outcome.when.logical_operator === 'and'
            ? ('or' as LogicalOperator)
            : ('and' as LogicalOperator)
      })
      setInputs(newInputs)
    },
    [setInputs],
  )

  const handleAddSubVariableCondition = useCallback(
    (outcomeId: string, conditionId: string, key?: string) => {
      const newInputs = produce(inputsRef.current, (draft) => {
        const condition = draft.outcomes.find((outcome) => outcome.id === outcomeId)?.when
        if (typeof condition !== 'object' || condition === null) return

        const targetCondition = condition.conditions.find((item) => item.id === conditionId)
        if (!targetCondition) return

        if (!targetCondition.sub_variable_condition)
          targetCondition.sub_variable_condition = {
            case_id: uuid4(),
            logical_operator: 'and' as LogicalOperator,
            conditions: [],
          }

        targetCondition.sub_variable_condition.conditions.push({
          id: uuid4(),
          key: key || '',
          varType: VarType.string,
          comparison_operator: undefined,
          value: '',
        })
      })
      setInputs(newInputs)
    },
    [setInputs],
  )

  const handleRemoveSubVariableCondition = useCallback(
    (outcomeId: string, conditionId: string, subConditionId: string) => {
      const newInputs = produce(inputsRef.current, (draft) => {
        const subVariableCondition = draft.outcomes.find(
          (outcome) => outcome.id === outcomeId,
        )?.when
        if (typeof subVariableCondition !== 'object' || subVariableCondition === null) return

        const target = subVariableCondition.conditions.find(
          (item) => item.id === conditionId,
        )?.sub_variable_condition
        if (!target) return

        target.conditions = target.conditions.filter((item) => item.id !== subConditionId)
      })
      setInputs(newInputs)
    },
    [setInputs],
  )

  const handleUpdateSubVariableCondition = useCallback(
    (outcomeId: string, conditionId: string, subConditionId: string, nextCondition: Condition) => {
      const newInputs = produce(inputsRef.current, (draft) => {
        const subVariableCondition = draft.outcomes.find(
          (outcome) => outcome.id === outcomeId,
        )?.when
        if (typeof subVariableCondition !== 'object' || subVariableCondition === null) return

        const targetSubCondition = subVariableCondition.conditions
          .find((item) => item.id === conditionId)
          ?.sub_variable_condition?.conditions.find((item) => item.id === subConditionId)
        if (targetSubCondition) Object.assign(targetSubCondition, nextCondition)
      })
      setInputs(newInputs)
    },
    [setInputs],
  )

  const handleToggleSubVariableConditionLogicalOperator = useCallback(
    (outcomeId: string, conditionId: string) => {
      const newInputs = produce(inputsRef.current, (draft) => {
        const subVariableCondition = draft.outcomes.find(
          (outcome) => outcome.id === outcomeId,
        )?.when
        if (typeof subVariableCondition !== 'object' || subVariableCondition === null) return

        const target = subVariableCondition.conditions.find(
          (item) => item.id === conditionId,
        )?.sub_variable_condition
        if (!target) return

        target.logical_operator =
          target.logical_operator === 'and' ? ('or' as LogicalOperator) : ('and' as LogicalOperator)
      })
      setInputs(newInputs)
    },
    [setInputs],
  )

  const handleInputsChange = useCallback(
    (newInputs: Variable[]) => {
      const newPayload = produce(inputsRef.current, (draft) => {
        draft.inputs = newInputs
      })
      setInputs(newPayload)
    },
    [setInputs],
  )

  const handleModelChanged = useCallback(
    (model: { provider: string; modelId: string; mode?: string }) => {
      const newInputs = produce(inputsRef.current, (draft) => {
        if (!draft.model)
          draft.model = {
            provider: '',
            name: '',
            mode: 'chat',
            completion_params: {},
          }
        draft.model.provider = model.provider
        draft.model.name = model.modelId
        draft.model.mode = model.mode!
      })
      setInputs(newInputs)
    },
    [setInputs],
  )

  const { currentProvider, currentModel, defaultModel } =
    useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.textGeneration)

  useEffect(() => {
    if (inputs.decide_by !== DecideBy.llm) return
    if (inputs.model?.provider) return
    if (!currentProvider?.provider || !currentModel?.model) return

    startTransition(() => {
      handleModelChanged({
        provider: currentProvider.provider,
        modelId: currentModel.model,
        mode: currentModel.model_properties?.mode as string | undefined,
      })
    })
  }, [inputs.decide_by, inputs.model?.provider, currentProvider, currentModel, handleModelChanged])

  const handleCompletionParamsChange = useCallback(
    (newParams: Record<string, unknown>) => {
      const newInputs = produce(inputsRef.current, (draft) => {
        if (draft.model) draft.model.completion_params = newParams
      })
      setInputs(newInputs)
    },
    [setInputs],
  )

  const handleGlossaryChange = useCallback(
    (glossary: string) => {
      const newInputs = produce(inputsRef.current, (draft) => {
        draft.context.glossary = glossary
      })
      setInputs(newInputs)
    },
    [setInputs],
  )

  const handlePromptChange = useCallback(
    (prompt: string) => {
      const newInputs = produce(inputsRef.current, (draft) => {
        draft.context.prompt = prompt
      })
      setInputs(newInputs)
    },
    [setInputs],
  )

  // --- Generate from "What you said" -------------------------------------

  // The node's own model when one is set, otherwise the workspace default text
  // generation model — the same fallback the other generate-with-AI flows use.
  const generationModel = useMemo<ModelConfig | null>(() => {
    if (inputs.model?.provider && inputs.model.name) return inputs.model
    if (!defaultModel?.provider?.provider || !defaultModel.model) return null

    return {
      provider: defaultModel.provider.provider,
      name: defaultModel.model,
      mode: 'chat',
      completion_params: {},
    }
  }, [inputs.model, defaultModel])

  // Everything this node can read, in the shape the generator expects.
  const { availableVariables, varTypesBySelector } = useMemo(
    () => toGeneratorVariables(availableVars, MAX_AVAILABLE_VARIABLES),
    [availableVars],
  )

  const [suggestedReason, setSuggestedReason] = useState('')
  const [generateFeedback, setGenerateFeedback] = useState<GenerateFeedback>(null)
  const [isConfirmReplaceOpen, setIsConfirmReplaceOpen] = useState(false)

  const { mutateAsync: generateDecision, isPending: isGenerating } = useMutation(
    consoleQuery.decisionGenerate.post.mutationOptions(),
  )

  const buildGenerateBody = useCallback(
    (
      model: ModelConfig,
      overrides: { decide_by: 'rules' | 'llm' | null; outcomes: { id: string; label: string }[] },
    ) => ({
      instruction: inputsRef.current.intent.trim(),
      model_config: {
        provider: model.provider,
        name: model.name,
        mode: model.mode === 'completion' ? ('completion' as const) : ('chat' as const),
        completion_params: model.completion_params ?? {},
      },
      available_variables: availableVariables,
      decide_by: overrides.decide_by,
      outcomes: overrides.outcomes,
      language: locale,
    }),
    [availableVariables, locale],
  )

  // Write a generated configuration into the node in one update, then bring the
  // canvas in line: exits are rebuilt and edges on vanished handles are gone.
  const applyGenerated = useCallback(
    (result: DecisionGenerateResponse) => {
      const generated = toGeneratedDecision(result, varTypesBySelector)
      const nextOutcomeIds = new Set(generated.outcomes.map((outcome) => outcome.id))
      inputsRef.current.outcomes
        .filter((outcome) => !nextOutcomeIds.has(outcome.id))
        .forEach((outcome) => handleEdgeDeleteByDeleteBranch(id, outcome.id))

      const newInputs = produce(inputsRef.current, (draft) => {
        draft.decide_by = generated.decide_by
        draft.outcomes = generated.outcomes
        draft.otherwise = generated.otherwise
        draft.inputs = generated.inputs
        draft.extras = generated.extras
        if (generated.decide_by === DecideBy.llm && !draft.model?.provider && generationModel)
          draft.model = cloneDeep(generationModel)
        syncTargetBranches(draft)
      })
      setExtraKeys(generated.extras.map(() => uuid4()))
      setInputs(newInputs)
      updateNodeInternals(id)
    },
    [
      generationModel,
      handleEdgeDeleteByDeleteBranch,
      id,
      setInputs,
      updateNodeInternals,
      varTypesBySelector,
    ],
  )

  const runGenerate = useCallback(async () => {
    if (!generationModel) return
    setGenerateFeedback(null)
    const nodeIdAtRequest = panelNodeIdRef.current
    try {
      const result = await generateDecision({
        body: buildGenerateBody(generationModel, { decide_by: null, outcomes: [] }),
      })
      // The panel may have switched to another node while the request was
      // pending; a late response no longer belongs to this node.
      if (panelNodeIdRef.current !== nodeIdAtRequest) return
      if (result.error) {
        setGenerateFeedback({ kind: 'error', message: result.error })
        return
      }
      applyGenerated(result)
      setSuggestedReason(result.decide_by_reason ?? '')
    } catch (error) {
      if (panelNodeIdRef.current !== nodeIdAtRequest) return
      setGenerateFeedback({
        kind: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }, [applyGenerated, buildGenerateBody, generateDecision, generationModel])

  const handleGenerate = useCallback(() => {
    if (readOnly || isGenerating) return
    if (!inputsRef.current.intent.trim()) return
    if (!generationModel) {
      setGenerateFeedback({ kind: 'noModel' })
      return
    }
    if (hasRulesToLose(inputsRef.current.outcomes)) {
      setIsConfirmReplaceOpen(true)
      return
    }
    void runGenerate()
  }, [generationModel, isGenerating, readOnly, runGenerate])

  const handleConfirmReplace = useCallback(() => {
    setIsConfirmReplaceOpen(false)
    void runGenerate()
  }, [runGenerate])

  const handleCancelReplace = useCallback(() => setIsConfirmReplaceOpen(false), [])

  // --- Extra outputs ------------------------------------------------------

  const handleAddExtra = useCallback(() => {
    const newInputs = produce(inputsRef.current, (draft) => {
      draft.extras.push({ name: '', from: 'fixed', values: {}, hint: '' })
    })
    setInputs(newInputs)
    setExtraKeys((keys) => [...keys, uuid4()])
  }, [setInputs])

  // The name is committed once, when the input's edit ends: a valid name
  // updates the node and follows downstream references; an empty or invalid
  // draft never enters node data, so the committed identity stays intact.
  const handleCommitExtraName = useCallback(
    (index: number, name: string) => {
      const extras = inputsRef.current.extras
      const previousName = extras[index]?.name
      if (name === previousName) return
      if (
        getExtraNameError(
          extras.map((extra, i) => (i === index ? { ...extra, name } : extra)),
          index,
        )
      )
        return

      const newInputs = produce(inputsRef.current, (draft) => {
        const extra = draft.extras[index]
        if (extra) extra.name = name
      })
      setInputs(newInputs)
      // Downstream nodes address an extra by name, so a rename follows it.
      if (previousName) handleOutVarRenameChange(id, [id, previousName], [id, name])
    },
    [handleOutVarRenameChange, id, setInputs],
  )

  const handleUpdateExtraSource = useCallback(
    (index: number, from: ExtraSource) => {
      const newInputs = produce(inputsRef.current, (draft) => {
        const extra = draft.extras[index]
        if (extra) extra.from = from
      })
      setInputs(newInputs)
    },
    [setInputs],
  )

  const handleUpdateExtraValue = useCallback(
    (index: number, outcomeId: string, value: string) => {
      const newInputs = produce(inputsRef.current, (draft) => {
        const extra = draft.extras[index]
        if (!extra) return
        extra.values = { ...extra.values, [outcomeId]: value }
      })
      setInputs(newInputs)
    },
    [setInputs],
  )

  const handleUpdateExtraHint = useCallback(
    (index: number, hint: string) => {
      const newInputs = produce(inputsRef.current, (draft) => {
        const extra = draft.extras[index]
        if (extra) extra.hint = hint
      })
      setInputs(newInputs)
    },
    [setInputs],
  )

  const [pendingRemoveExtraIndex, setPendingRemoveExtraIndex] = useState<number | null>(null)

  const removeExtra = useCallback(
    (index: number) => {
      const name = inputsRef.current.extras[index]?.name
      const newInputs = produce(inputsRef.current, (draft) => {
        draft.extras.splice(index, 1)
      })
      setInputs(newInputs)
      setExtraKeys((keys) => keys.filter((_, keyIndex) => keyIndex !== index))
      if (name) removeUsedVarInNodes([id, name])
    },
    [id, removeUsedVarInNodes, setInputs],
  )

  const handleRemoveExtra = useCallback(
    (index: number) => {
      const name = inputsRef.current.extras[index]?.name
      if (name && isVarUsedInNodes([id, name])) {
        setPendingRemoveExtraIndex(index)
        return
      }
      removeExtra(index)
    },
    [id, isVarUsedInNodes, removeExtra],
  )

  const handleConfirmRemoveExtra = useCallback(() => {
    if (pendingRemoveExtraIndex === null) return
    removeExtra(pendingRemoveExtraIndex)
    setPendingRemoveExtraIndex(null)
  }, [pendingRemoveExtraIndex, removeExtra])

  const handleCancelRemoveExtra = useCallback(() => setPendingRemoveExtraIndex(null), [])

  return {
    readOnly,
    inputs,
    isRulesMode,
    filterVar,
    filterNumberVar,
    handleIntentChange,
    handleDecideByChange,
    handleAddOutcome,
    handleRemoveOutcome,
    handleUpdateOutcomeLabel,
    handleUpdateOutcomeWhenText,
    handleOtherwiseLabelChange,
    handleAddCondition,
    handleRemoveCondition,
    handleUpdateCondition,
    handleToggleConditionLogicalOperator,
    handleAddSubVariableCondition,
    handleRemoveSubVariableCondition,
    handleUpdateSubVariableCondition,
    handleToggleSubVariableConditionLogicalOperator,
    handleInputsChange,
    handleModelChanged,
    handleCompletionParamsChange,
    handleGlossaryChange,
    handlePromptChange,
    handleGenerate,
    handleConfirmReplace,
    handleCancelReplace,
    isGenerating,
    generateFeedback,
    suggestedReason,
    isConfirmReplaceOpen,
    handleAddExtra,
    handleRemoveExtra,
    handleCommitExtraName,
    extraKeys,
    handleUpdateExtraSource,
    handleUpdateExtraValue,
    handleUpdateExtraHint,
    isConfirmRemoveExtraOpen: pendingRemoveExtraIndex !== null,
    handleConfirmRemoveExtra,
    handleCancelRemoveExtra,
    nodesOutputVars: availableVars,
    availableNodes: availableNodesWithParent,
    varsIsVarFileAttribute,
  }
}

export default useConfig

export type DecisionConfig = ReturnType<typeof useConfig>
