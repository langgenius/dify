import {
  isAgentComposerDirtyAtom,
  useConfigPublishPayload,
  useHydrateAgentSoulConfigFormState,
} from '@/features/agent-v2/agent-composer/store'
import { agentComposerAppFeaturesAtom, useAppFeatures } from '@/features/agent-v2/agent-composer/store-modules/app-features'
import { agentComposerEnvVariablesAtom, useEnvVariables } from '@/features/agent-v2/agent-composer/store-modules/env'
import { agentComposerFilesAtom, useFiles } from '@/features/agent-v2/agent-composer/store-modules/files'
import { agentComposerKnowledgeRetrievalsAtom, useKnowledgeRetrievals } from '@/features/agent-v2/agent-composer/store-modules/knowledge'
import { agentComposerModelAtom, useCurrentModel, useModel } from '@/features/agent-v2/agent-composer/store-modules/model'
import { agentComposerPromptAtom, usePrompt } from '@/features/agent-v2/agent-composer/store-modules/prompt'
import { agentComposerSkillsAtom, useRemoveSkill, useSkills } from '@/features/agent-v2/agent-composer/store-modules/skills'
import { agentComposerToolsAtom, agentComposerToolSettingsAtom, useTools, useToolSettings } from '@/features/agent-v2/agent-composer/store-modules/tools'

export const agentConfigurePromptAtom = agentComposerPromptAtom
export const agentConfigureModelAtom = agentComposerModelAtom
export const agentConfigureAppFeaturesAtom = agentComposerAppFeaturesAtom
export const agentConfigureSkillsAtom = agentComposerSkillsAtom
export const agentConfigureFilesAtom = agentComposerFilesAtom
export const agentConfigureToolsAtom = agentComposerToolsAtom
export const agentConfigureKnowledgeRetrievalsAtom = agentComposerKnowledgeRetrievalsAtom
export const agentConfigureEnvVariablesAtom = agentComposerEnvVariablesAtom
export const agentConfigureToolSettingsAtom = agentComposerToolSettingsAtom
export const isAgentConfigureDirtyAtom = isAgentComposerDirtyAtom

export const useHydrateAgentConfigureDraft = useHydrateAgentSoulConfigFormState
export const useAgentConfigurePrompt = usePrompt
export const useAgentConfigureModel = useModel
export const useAgentConfigureCurrentModel = useCurrentModel
export const useAgentConfigureAppFeatures = useAppFeatures
export const useAgentConfigurePublishPayload = useConfigPublishPayload
export const useAgentConfigureSkills = useSkills
export const useAgentConfigureFiles = useFiles
export const useAgentConfigureTools = useTools
export const useAgentConfigureKnowledgeRetrievals = useKnowledgeRetrievals
export const useAgentConfigureEnvVariables = useEnvVariables
export const useAgentConfigureToolSettings = useToolSettings
export const useRemoveAgentConfigureSkill = useRemoveSkill
