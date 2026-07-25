import { getGeneratedTextMaterialPath, getTestMaterialPath } from '../../../support/test-materials'

export const agentBuilderTestMaterials = {
  smallFile: 'agent-small-file.txt',
  knowledgeSource: 'agent-knowledge-source.txt',
  emptyFile: 'agent-empty-file.txt',
  unsupportedFile: 'agent-unsupported-file.exe',
  specialFilename: 'agent-special-filename-中文 @#$%.txt',
  validEnv: 'agent-valid.env',
  invalidEnv: 'agent-invalid.env',
  buildInstruction: 'agent-build-instruction.txt',
  summarySkill: 'e2e-summary-skill/SKILL.md',
} as const

export const agentBuilderGeneratedTestMaterials = {
  tooLargeFile: 'agent-too-large-file.txt',
} as const

export const getAgentBuilderTestMaterialPath = (material: keyof typeof agentBuilderTestMaterials) =>
  getTestMaterialPath(agentBuilderTestMaterials[material])

export const getTooLargeAgentFilePath = () =>
  getGeneratedTextMaterialPath({
    fileName: 'agent-too-large-file.txt',
    sizeBytes: 16 * 1024 * 1024,
    seedText: 'E2E_TOO_LARGE_FILE_FIXTURE',
  })
