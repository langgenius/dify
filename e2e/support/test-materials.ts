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
