import type {
  AgentConfigFileRefConfig,
  AgentConfigFileUploadResponse,
  AgentConfigSkillRefConfig,
  AgentConfigSkillUploadResponse,
  AgentDriveSkillItemResponse,
  AgentDriveSkillListResponse,
  AgentSkillUploadResponse,
} from '@dify/contracts/api/console/agent/types.gen'
import type { ConsoleClient } from '../../../support/api/console-client'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const crc32Table = new Uint32Array(256)
for (let i = 0; i < crc32Table.length; i++) {
  let c = i
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  crc32Table[i] = c >>> 0
}

const crc32 = (buffer: Buffer) => {
  let crc = 0xffffffff
  for (const byte of buffer) crc = crc32Table[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

const createSingleFileZip = ({ content, entryName }: { content: Buffer; entryName: string }) => {
  const entryNameBuffer = Buffer.from(entryName)
  const checksum = crc32(content)
  const localHeader = Buffer.alloc(30)
  localHeader.writeUInt32LE(0x04034b50, 0)
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
  centralDirectoryHeader.writeUInt32LE(0x02014b50, 0)
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
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0)
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
  const archiveBaseName =
    sourceDirName && sourceDirName !== '.'
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

const createUploadFile = (content: Buffer, name: string, type: string) =>
  new File([Uint8Array.from(content)], name, { type })

export async function uploadAgentDriveSkill(
  client: ConsoleClient,
  {
    agentId,
    fileName,
    filePath,
  }: {
    agentId: string
    fileName: string
    filePath: string
  },
): Promise<AgentSkillUploadResponse> {
  const upload = await toSkillArchiveUpload({ fileName, filePath })
  return client.agent.byAgentId.skills.upload.post({
    body: { file: createUploadFile(upload.buffer, upload.name, 'application/zip') },
    params: { agent_id: agentId },
  })
}

export async function uploadAgentConfigFileToDraft(
  client: ConsoleClient,
  {
    agentId,
    fileName,
    filePath,
  }: {
    agentId: string
    fileName: string
    filePath: string
  },
): Promise<AgentConfigFileRefConfig> {
  const uploadedFile = await client.files.upload.post({
    body: { file: createUploadFile(await readFile(filePath), fileName, 'text/plain') },
  })
  const body: AgentConfigFileUploadResponse = await client.agent.byAgentId.config.files.post({
    body: { upload_file_id: uploadedFile.id },
    params: { agent_id: agentId },
  })
  const file = body.file
  if (!file.file_id) throw new Error(`Agent v2 config file ${fileName} did not return a file_id.`)

  return {
    file_id: file.file_id,
    file_kind: 'upload_file',
    hash: file.hash,
    mime_type: file.mime_type,
    name: file.name,
    size: file.size,
  }
}

export async function uploadAgentConfigSkillToDraft(
  client: ConsoleClient,
  {
    agentId,
    fileName,
    filePath,
  }: {
    agentId: string
    fileName: string
    filePath: string
  },
): Promise<AgentConfigSkillRefConfig> {
  const upload = await toSkillArchiveUpload({ fileName, filePath })
  const body: AgentConfigSkillUploadResponse =
    await client.agent.byAgentId.config.skills.upload.post({
      body: { file: createUploadFile(upload.buffer, upload.name, 'application/zip') },
      params: { agent_id: agentId },
    })
  const skill = body.skill
  if (!skill.file_id) throw new Error(`Agent v2 config skill ${fileName} did not return a file_id.`)

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

export async function getAgentDriveSkills(
  client: ConsoleClient,
  agentId: string,
): Promise<AgentDriveSkillItemResponse[]> {
  const body: AgentDriveSkillListResponse = await client.agent.byAgentId.drive.skills.get({
    params: { agent_id: agentId },
  })
  return body.items ?? []
}
