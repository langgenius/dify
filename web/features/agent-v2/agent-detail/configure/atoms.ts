import {
  agentComposerAppFeaturesAtom,
  agentComposerEnvVariablesAtom,
  agentComposerFilesAtom,
  agentComposerKnowledgeRetrievalsAtom,
  agentComposerModelAtom,
  agentComposerPromptAtom,
  agentComposerSkillsAtom,
  agentComposerToolsAtom,
  agentComposerToolSettingsAtom,
  isAgentComposerDirtyAtom,
  useAppFeatures,
  useConfigPublishPayload,
  useCurrentModel,
  useEnvVariables,
  useFiles,
  useHydrateAgentSoulConfigFormState,
  useKnowledgeRetrievals,
  useModel,
  usePrompt,
  useRemoveSkill,
  useSkills,
  useTools,
  useToolSettings,
} from '@/features/agent-v2/agent-composer/store'

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
