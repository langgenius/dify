import path from 'node:path'
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
  fileTreeFixture: 'file_tree_fixture',
  countBatch5: 'count_batch_5_valid_files',
  countBatch6: 'count_batch_6_valid_files',
  countTotal50: 'count_total_50_valid_files',
  countTotalExtra1: 'count_total_extra_1_valid_file',
} as const

export const agentBuilderGeneratedTestMaterials = {
  slowUploadFile: 'agent-slow-upload-file.txt',
  tooLargeFile: 'agent-too-large-file.txt',
} as const

export const agentBuilderFileTreeFixtureFiles = [
  'assets/sample.csv',
  'docs/中文说明.md',
  'public/index.html',
  'src/main.txt',
  'web-game/README.md',
] as const

export const agentBuilderFileTreeFixtureFileNames = agentBuilderFileTreeFixtureFiles
  .map(filePath => path.basename(filePath))

export const getAgentBuilderTestMaterialPath = (material: keyof typeof agentBuilderTestMaterials) =>
  getTestMaterialPath(agentBuilderTestMaterials[material])

export const getTooLargeAgentFilePath = () =>
  getGeneratedTextMaterialPath({
    fileName: 'agent-too-large-file.txt',
    sizeBytes: 16 * 1024 * 1024,
    seedText: 'E2E_TOO_LARGE_FILE_FIXTURE',
  })

export const getSlowUploadAgentFilePath = () =>
  getGeneratedTextMaterialPath({
    fileName: 'agent-slow-upload-file.txt',
    sizeBytes: 2 * 1024 * 1024,
    seedText: 'E2E_SLOW_UPLOAD_FILE_FIXTURE',
  })
