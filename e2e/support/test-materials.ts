import { Buffer } from 'node:buffer'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const testMaterialsDir = fileURLToPath(
  new URL('../fixtures/test-materials', import.meta.url),
)
export const generatedTestMaterialsDir = fileURLToPath(
  new URL('../.generated-test-materials', import.meta.url),
)

export const getTestMaterialPath = (fileName: string) => path.join(testMaterialsDir, fileName)

export const agentBuilderTestMaterials = {
  smallFile: 'agent-small-file.txt',
  knowledgeSource: 'agent-knowledge-source.txt',
  emptyFile: 'agent-empty-file.txt',
  unsupportedFile: 'agent-unsupported-file.exe',
  specialFilename: 'agent-special-filename-中文 @#$%.txt',
  validEnv: 'agent-valid.env',
  invalidEnv: 'agent-invalid.env',
  buildInstruction: 'agent-build-instruction.txt',
  summarySkill: 'e2e-summary.SKILL.md',
  fileTreeFixture: 'file_tree_fixture',
  countBatch5: 'count_batch_5_valid_files',
  countBatch6: 'count_batch_6_valid_files',
  countTotal50: 'count_total_50_valid_files',
  countTotalExtra1: 'count_total_extra_1_valid_file',
} as const

export const getAgentBuilderTestMaterialPath = (
  material: keyof typeof agentBuilderTestMaterials,
) => getTestMaterialPath(agentBuilderTestMaterials[material])

export async function getGeneratedTextMaterialPath({
  fileName,
  sizeBytes,
  seedText,
}: {
  fileName: string
  sizeBytes: number
  seedText: string
}) {
  await mkdir(generatedTestMaterialsDir, { recursive: true })

  const targetPath = path.join(generatedTestMaterialsDir, fileName)
  const chunk = `${seedText}\n`
  const repeatCount = Math.ceil(sizeBytes / Buffer.byteLength(chunk))
  const contents = chunk.repeat(repeatCount).slice(0, sizeBytes)
  await writeFile(targetPath, contents)

  return targetPath
}

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
