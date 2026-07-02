import type {
  AgentConfigFileRefConfig,
  AgentConfigFileUploadResponse,
  AgentConfigSkillRefConfig,
  AgentConfigSkillUploadResponse,
  AgentDriveSkillItemResponse,
  AgentDriveSkillListResponse,
  AgentSkillUploadResponse,
} from '@dify/contracts/api/console/agent/types.gen'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createApiContext, expectApiResponseOK } from '../../../support/api'

export type UploadedConsoleFile = {
  id: string
  mime_type?: string | null
  name: string
  size?: number | null
}

const crc32Table = new Uint32Array(256)
for (let i = 0; i < crc32Table.length; i++) {
  let c = i
  for (let k = 0; k < 8; k++)
    c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
  crc32Table[i] = c >>> 0
}

const crc32 = (buffer: Buffer) => {
  let crc = 0xFFFFFFFF
  for (const byte of buffer)
    crc = crc32Table[(crc ^ byte) & 0xFF]! ^ (crc >>> 8)
  return (crc ^ 0xFFFFFFFF) >>> 0
}

const createSingleFileZip = ({
  content,
  entryName,
}: {
  content: Buffer
  entryName: string
}) => {
  const entryNameBuffer = Buffer.from(entryName)
  const checksum = crc32(content)
  const localHeader = Buffer.alloc(30)
  localHeader.writeUInt32LE(0x04034B50, 0)
  localHeader.writeUInt16LE(20, 4)
  localHeader.writeUInt16LE(0, 6)
  localHeader.writeUInt16LE(0, 8)
  localHeader.writeUInt16LE(0, 10)
  localHeader.writeUInt16LE(0, 12)
  localHeader.writeUInt32LE(checksum, 14)
  localHeader.writeUInt32LE(content.length, 18)
  localHeader.writeUInt32LE(content.length, 22)
  localHeader.writeUInt16LE(entryNameBuffer.length, 26)
  localHeader.writeUInt16LE(0, 28)

  const centralDirectoryOffset = localHeader.length + entryNameBuffer.length + content.length
  const centralDirectoryHeader = Buffer.alloc(46)
  centralDirectoryHeader.writeUInt32LE(0x02014B50, 0)
  centralDirectoryHeader.writeUInt16LE(20, 4)
  centralDirectoryHeader.writeUInt16LE(20, 6)
  centralDirectoryHeader.writeUInt16LE(0, 8)
  centralDirectoryHeader.writeUInt16LE(0, 10)
  centralDirectoryHeader.writeUInt16LE(0, 12)
  centralDirectoryHeader.writeUInt16LE(0, 14)
  centralDirectoryHeader.writeUInt32LE(checksum, 16)
  centralDirectoryHeader.writeUInt32LE(content.length, 20)
  centralDirectoryHeader.writeUInt32LE(content.length, 24)
  centralDirectoryHeader.writeUInt16LE(entryNameBuffer.length, 28)
  centralDirectoryHeader.writeUInt16LE(0, 30)
  centralDirectoryHeader.writeUInt16LE(0, 32)
  centralDirectoryHeader.writeUInt16LE(0, 34)
  centralDirectoryHeader.writeUInt16LE(0, 36)
  centralDirectoryHeader.writeUInt32LE(0, 38)
  centralDirectoryHeader.writeUInt32LE(0, 42)

  const centralDirectorySize = centralDirectoryHeader.length + entryNameBuffer.length
  const endOfCentralDirectory = Buffer.alloc(22)
  endOfCentralDirectory.writeUInt32LE(0x06054B50, 0)
  endOfCentralDirectory.writeUInt16LE(0, 4)
  endOfCentralDirectory.writeUInt16LE(0, 6)
  endOfCentralDirectory.writeUInt16LE(1, 8)
  endOfCentralDirectory.writeUInt16LE(1, 10)
  endOfCentralDirectory.writeUInt32LE(centralDirectorySize, 12)
  endOfCentralDirectory.writeUInt32LE(centralDirectoryOffset, 16)
  endOfCentralDirectory.writeUInt16LE(0, 20)

  return Buffer.concat([
    localHeader,
    entryNameBuffer,
    content,
    centralDirectoryHeader,
    entryNameBuffer,
    endOfCentralDirectory,
  ])
}

const toSkillArchiveUpload = async ({
  fileName,
  filePath,
}: {
  fileName: string
  filePath: string
}) => {
  if (fileName.endsWith('.zip') || fileName.endsWith('.skill')) {
    return {
      buffer: await readFile(filePath),
      name: path.basename(fileName),
    }
  }
  const sourceDirName = path.basename(path.dirname(fileName))
  const archiveBaseName = sourceDirName && sourceDirName !== '.'
    ? sourceDirName
    : path.basename(fileName, path.extname(fileName))

  return {
    buffer: createSingleFileZip({
      content: await readFile(filePath),
      entryName: 'SKILL.md',
    }),
    name: `${archiveBaseName}.skill`,
  }
}

export async function uploadAgentDriveSkill({
  agentId,
  fileName,
  filePath,
}: {
  agentId: string
  fileName: string
  filePath: string
}): Promise<AgentSkillUploadResponse> {
  const ctx = await createApiContext()
  try {
    const upload = await toSkillArchiveUpload({ fileName, filePath })
    const response = await ctx.post(`/console/api/agent/${agentId}/skills/upload`, {
      multipart: {
        file: {
          buffer: upload.buffer,
          mimeType: 'application/zip',
          name: upload.name,
        },
      },
    })
    await expectApiResponseOK(response, `Upload Agent v2 drive skill ${fileName} for ${agentId}`)
    return (await response.json()) as AgentSkillUploadResponse
  }
  finally {
    await ctx.dispose()
  }
}

export async function uploadAgentConfigFileToDraft({
  agentId,
  fileName,
  filePath,
}: {
  agentId: string
  fileName: string
  filePath: string
}): Promise<AgentConfigFileRefConfig> {
  const ctx = await createApiContext()
  try {
    const uploadResponse = await ctx.post('/console/api/files/upload', {
      multipart: {
        file: {
          buffer: await readFile(filePath),
          mimeType: 'text/plain',
          name: fileName,
        },
      },
    })
    await expectApiResponseOK(uploadResponse, `Upload Agent v2 config source file ${fileName}`)
    const uploadedFile = (await uploadResponse.json()) as UploadedConsoleFile

    const commitResponse = await ctx.post(`/console/api/agent/${agentId}/config/files`, {
      data: {
        upload_file_id: uploadedFile.id,
      },
    })
    await expectApiResponseOK(commitResponse, `Commit Agent v2 config file ${fileName} for ${agentId}`)
    const body = (await commitResponse.json()) as AgentConfigFileUploadResponse
    const file = body.file
    if (!file.file_id)
      throw new Error(`Agent v2 config file ${fileName} did not return a file_id.`)

    return {
      file_id: file.file_id,
      file_kind: 'upload_file',
      hash: file.hash,
      mime_type: file.mime_type,
      name: file.name,
      size: file.size,
    }
  }
  finally {
    await ctx.dispose()
  }
}

export async function uploadAgentConfigSkillToDraft({
  agentId,
  fileName,
  filePath,
}: {
  agentId: string
  fileName: string
  filePath: string
}): Promise<AgentConfigSkillRefConfig> {
  const ctx = await createApiContext()
  try {
    const upload = await toSkillArchiveUpload({ fileName, filePath })
    const response = await ctx.post(`/console/api/agent/${agentId}/config/skills/upload`, {
      multipart: {
        file: {
          buffer: upload.buffer,
          mimeType: 'application/zip',
          name: upload.name,
        },
      },
    })
    await expectApiResponseOK(response, `Upload Agent v2 config skill ${fileName} for ${agentId}`)
    const body = (await response.json()) as AgentConfigSkillUploadResponse
    const skill = body.skill
    if (!skill.file_id)
      throw new Error(`Agent v2 config skill ${fileName} did not return a file_id.`)

    return {
      description: skill.description,
      file_id: skill.file_id,
      file_kind: 'tool_file',
      hash: skill.hash,
      mime_type: skill.mime_type,
      name: skill.name,
      size: skill.size,
    }
  }
  finally {
    await ctx.dispose()
  }
}

export async function getAgentDriveSkills(agentId: string): Promise<AgentDriveSkillItemResponse[]> {
  const ctx = await createApiContext()
  try {
    const response = await ctx.get(`/console/api/agent/${agentId}/drive/skills`)
    await expectApiResponseOK(response, `Get Agent v2 drive skills for ${agentId}`)
    const body = (await response.json()) as AgentDriveSkillListResponse
    return body.items ?? []
  }
  finally {
    await ctx.dispose()
  }
}

export async function deleteAgentConfigFile(agentId: string, name: string): Promise<void> {
  const ctx = await createApiContext()
  try {
    const response = await ctx.delete(`/console/api/agent/${agentId}/config/files/${encodeURIComponent(name)}`)
    await expectApiResponseOK(response, `Delete Agent v2 config file ${name} for ${agentId}`)
  }
  finally {
    await ctx.dispose()
  }
}

export async function deleteAgentConfigSkill(agentId: string, name: string): Promise<void> {
  const ctx = await createApiContext()
  try {
    const response = await ctx.delete(`/console/api/agent/${agentId}/config/skills/${encodeURIComponent(name)}`)
    await expectApiResponseOK(response, `Delete Agent v2 config skill ${name} for ${agentId}`)
  }
  finally {
    await ctx.dispose()
  }
}

export async function deleteAgentDriveFile(agentId: string, key: string): Promise<void> {
  const ctx = await createApiContext()
  try {
    const searchParams = new URLSearchParams({ key })
    const response = await ctx.delete(`/console/api/agent/${agentId}/files?${searchParams}`)
    await expectApiResponseOK(response, `Delete Agent v2 drive file ${key} for ${agentId}`)
  }
  finally {
    await ctx.dispose()
  }
}
