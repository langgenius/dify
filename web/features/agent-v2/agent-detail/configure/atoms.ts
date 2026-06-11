import {
  agentComposerConfigAtom,
  agentComposerEnvVariablesAtom,
  agentComposerFilesAtom,
  agentComposerKnowledgeRetrievalsAtom,
  agentComposerModelAtom,
  agentComposerPromptAtom,
  agentComposerSkillsAtom,
  agentComposerToolsAtom,
  agentComposerToolSettingsAtom,
  isAgentComposerDirtyAtom,
  useConfig,
  useConfigPublishPayload,
  useCurrentModel,
  useEnvVariables,
  useFiles,
  useHydrateAgentComposerDraft,
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
export const agentConfigureConfigAtom = agentComposerConfigAtom
export const agentConfigureSkillsAtom = agentComposerSkillsAtom
export const agentConfigureFilesAtom = agentComposerFilesAtom
export const agentConfigureToolsAtom = agentComposerToolsAtom
export const agentConfigureKnowledgeRetrievalsAtom = agentComposerKnowledgeRetrievalsAtom
export const agentConfigureEnvVariablesAtom = agentComposerEnvVariablesAtom
export const agentConfigureToolSettingsAtom = agentComposerToolSettingsAtom
export const isAgentConfigureDirtyAtom = isAgentComposerDirtyAtom

export const useHydrateAgentConfigureDraft = useHydrateAgentComposerDraft
export const useAgentConfigurePrompt = usePrompt
export const useAgentConfigureModel = useModel
export const useAgentConfigureCurrentModel = useCurrentModel
export const useAgentConfigureConfig = useConfig
export const useAgentConfigurePublishPayload = useConfigPublishPayload
export const useAgentConfigureSkills = useSkills
export const useAgentConfigureFiles = useFiles
export const useAgentConfigureTools = useTools
export const useAgentConfigureKnowledgeRetrievals = useKnowledgeRetrievals
export const useAgentConfigureEnvVariables = useEnvVariables
export const useAgentConfigureToolSettings = useToolSettings
export const useRemoveAgentConfigureSkill = useRemoveSkill
