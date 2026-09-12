import type {
  AppExportResponse,
  AppImportPayload,
} from '@dify/contracts/api/console/apps/types.gen'
import { downloadBlob } from '@/utils/download'

export async function readAppDSLFile(file: File): Promise<AppImportPayload> {
  if (file.size > 10 * 1024 * 1024) throw new Error('DSL files must not exceed 10 MB')

  if (!file.name.toLowerCase().endsWith('.zip'))
    return { mode: 'yaml-content', yaml_content: await file.text() }

  const yaml_content = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1]!)
    reader.onerror = () => reject(reader.error)
    reader.onabort = () => reject(new Error('DSL file read aborted'))
    reader.readAsDataURL(file)
  })
  return { mode: 'bundle-content', yaml_content }
}

export function downloadAppDSLFile({ data, format }: AppExportResponse, appName: string) {
  const isBundle = format === 'zip'
  downloadBlob({
    data: new Blob(
      [isBundle ? Uint8Array.from(atob(data), (character) => character.charCodeAt(0)) : data],
      { type: isBundle ? 'application/zip' : 'application/yaml' },
    ),
    fileName: `${appName}.${isBundle ? 'zip' : 'yml'}`,
  })
}
