'use client'

import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogCloseButton, DialogContent, DialogDescription, DialogTitle } from '@langgenius/dify-ui/dialog'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import { consoleQuery } from '@/service/client'
import { formatFileSize } from '@/utils/format'

const skillPackageAccept = '.zip,.skill'
const skillPackageExtensions = ['.zip', '.skill']
const textEncoder = new TextEncoder()

type SkillUploadFileEntry = {
  isFile: true
  isDirectory: false
  name: string
  file: (callback: (file: File) => void, errorCallback?: (error: DOMException) => void) => void
}

type SkillUploadDirectoryEntry = {
  isFile: false
  isDirectory: true
  name: string
  createReader: () => {
    readEntries: (callback: (entries: SkillUploadEntry[]) => void, errorCallback?: (error: DOMException) => void) => void
  }
}

type SkillUploadEntry = SkillUploadFileEntry | SkillUploadDirectoryEntry

type DataTransferItemWithEntry = {
  webkitGetAsEntry?: () => SkillUploadEntry | null
}

function isSupportedSkillPackage(file: File) {
  const fileName = file.name.toLowerCase()

  return skillPackageExtensions.some(extension => fileName.endsWith(extension))
}

function getCrc32(bytes: Uint8Array) {
  let crc = 0xFFFFFFFF

  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0)
  }

  return (crc ^ 0xFFFFFFFF) >>> 0
}

function writeUint16(buffer: Uint8Array, offset: number, value: number) {
  buffer[offset] = value & 0xFF
  buffer[offset + 1] = (value >>> 8) & 0xFF
}

function writeUint32(buffer: Uint8Array, offset: number, value: number) {
  buffer[offset] = value & 0xFF
  buffer[offset + 1] = (value >>> 8) & 0xFF
  buffer[offset + 2] = (value >>> 16) & 0xFF
  buffer[offset + 3] = (value >>> 24) & 0xFF
}

function normalizeArchivePath(path: string) {
  return path
    .replaceAll('\\', '/')
    .split('/')
    .filter(Boolean)
    .join('/')
}

function toArrayBuffer(bytes: Uint8Array) {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)

  return buffer
}

async function createSkillArchive(files: File[], archiveName = 'skill.skill') {
  const entries = await Promise.all(files.map(async (file) => {
    const relativePath = normalizeArchivePath(file.webkitRelativePath || file.name)
    return {
      path: relativePath,
      nameBytes: textEncoder.encode(relativePath),
      data: new Uint8Array(await file.arrayBuffer()),
    }
  }))
  const validEntries = entries.filter(entry => entry.path)
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0

  for (const entry of validEntries) {
    const crc32 = getCrc32(entry.data)
    const localHeader = new Uint8Array(30 + entry.nameBytes.length)
    writeUint32(localHeader, 0, 0x04034B50)
    writeUint16(localHeader, 4, 20)
    writeUint16(localHeader, 6, 0x0800)
    writeUint16(localHeader, 8, 0)
    writeUint16(localHeader, 10, 0)
    writeUint16(localHeader, 12, 0)
    writeUint32(localHeader, 14, crc32)
    writeUint32(localHeader, 18, entry.data.length)
    writeUint32(localHeader, 22, entry.data.length)
    writeUint16(localHeader, 26, entry.nameBytes.length)
    localHeader.set(entry.nameBytes, 30)
    localParts.push(localHeader, entry.data)

    const centralHeader = new Uint8Array(46 + entry.nameBytes.length)
    writeUint32(centralHeader, 0, 0x02014B50)
    writeUint16(centralHeader, 4, 20)
    writeUint16(centralHeader, 6, 20)
    writeUint16(centralHeader, 8, 0x0800)
    writeUint16(centralHeader, 10, 0)
    writeUint16(centralHeader, 12, 0)
    writeUint16(centralHeader, 14, 0)
    writeUint32(centralHeader, 16, crc32)
    writeUint32(centralHeader, 20, entry.data.length)
    writeUint32(centralHeader, 24, entry.data.length)
    writeUint16(centralHeader, 28, entry.nameBytes.length)
    writeUint32(centralHeader, 42, offset)
    centralHeader.set(entry.nameBytes, 46)
    centralParts.push(centralHeader)

    offset += localHeader.length + entry.data.length
  }

  const centralDirectorySize = centralParts.reduce((size, part) => size + part.length, 0)
  const endOfCentralDirectory = new Uint8Array(22)
  writeUint32(endOfCentralDirectory, 0, 0x06054B50)
  writeUint16(endOfCentralDirectory, 8, validEntries.length)
  writeUint16(endOfCentralDirectory, 10, validEntries.length)
  writeUint32(endOfCentralDirectory, 12, centralDirectorySize)
  writeUint32(endOfCentralDirectory, 16, offset)

  return new File([...localParts, ...centralParts, endOfCentralDirectory].map(toArrayBuffer), archiveName, {
    type: 'application/zip',
  })
}

function readFileEntry(entry: SkillUploadFileEntry, prefix: string): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file((file) => {
      Object.defineProperty(file, 'webkitRelativePath', {
        configurable: true,
        value: normalizeArchivePath(`${prefix}${file.name}`),
      })
      resolve(file)
    }, reject)
  })
}

function readDirectoryEntries(entry: SkillUploadDirectoryEntry): Promise<SkillUploadEntry[]> {
  const reader = entry.createReader()
  const entries: SkillUploadEntry[] = []

  return new Promise((resolve, reject) => {
    const readBatch = () => {
      reader.readEntries((batch) => {
        if (!batch.length) {
          resolve(entries)
          return
        }
        entries.push(...batch)
        readBatch()
      }, reject)
    }

    readBatch()
  })
}

async function traverseFileEntry(entry: SkillUploadEntry, prefix = ''): Promise<File[]> {
  if (entry.isFile)
    return [await readFileEntry(entry, prefix)]

  const childEntries = await readDirectoryEntries(entry)
  const childFiles = await Promise.all(childEntries.map(childEntry => traverseFileEntry(childEntry, `${prefix}${entry.name}/`)))

  return childFiles.flat()
}

async function normalizeSkillUpload(files: File[], packageName?: string) {
  if (!files.length)
    return undefined

  if (files.length === 1 && isSupportedSkillPackage(files[0]!))
    return files[0]

  const archiveName = `${packageName || files[0]?.webkitRelativePath?.split('/')[0] || 'skill'}.skill`
  return createSkillArchive(files, archiveName)
}

function AgentSkillPackageUploader({
  file,
  onChange,
}: {
  file?: File
  onChange: (file?: File) => void
}) {
  const { t } = useTranslation('agentV2')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [isPackaging, setIsPackaging] = useState(false)

  const setUploadFiles = async (files: File[], packageName?: string) => {
    if (!files.length) {
      toast.error(t('agentDetail.configure.skills.upload.emptyFolder'))
      return
    }

    setIsPackaging(true)
    try {
      const uploadFile = await normalizeSkillUpload(files, packageName)
      if (!uploadFile) {
        onChange(undefined)
        return
      }
      if (!isSupportedSkillPackage(uploadFile)) {
        toast.error(t('agentDetail.configure.skills.upload.invalidFile'))
        return
      }
      onChange(uploadFile)
    }
    finally {
      setIsPackaging(false)
    }
  }

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    setUploadFiles(files)
  }

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setDragging(false)

    const entries = Array.from(event.dataTransfer.items ?? [])
      .map(item => (item as unknown as DataTransferItemWithEntry).webkitGetAsEntry?.())
      .filter((entry): entry is SkillUploadEntry => !!entry)

    if (entries.length) {
      const files = (await Promise.all(entries.map(entry => traverseFileEntry(entry)))).flat()
      await setUploadFiles(files, entries[0]?.name)
      return
    }

    await setUploadFiles(Array.from(event.dataTransfer.files))
  }

  return (
    <div className="mt-6">
      <input
        ref={fileInputRef}
        className="hidden"
        type="file"
        multiple
        accept={skillPackageAccept}
        onChange={handleFileChange}
      />
      {!file && (
        <div
          className={cn(
            'relative flex h-16 items-center rounded-[10px] border border-dashed border-components-dropzone-border bg-components-dropzone-bg text-sm font-normal',
            dragging && 'border-components-dropzone-border-accent bg-components-dropzone-bg-accent',
          )}
          onDragEnter={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragOver={event => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          <div className="flex w-full items-center justify-center space-x-2">
            <span aria-hidden className="i-ri-upload-cloud-2-line size-6 text-text-tertiary" />
            <div className="text-text-tertiary">
              {isPackaging
                ? t('agentDetail.configure.skills.upload.packagingFolder')
                : t('agentDetail.configure.skills.upload.dropzone')}
              {!isPackaging && (
                <button
                  type="button"
                  className="inline cursor-pointer border-none bg-transparent p-0 pl-1 text-left text-text-accent focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {t('agentDetail.configure.skills.upload.browse')}
                </button>
              )}
            </div>
          </div>
          {dragging && <div className="absolute top-0 left-0 size-full" />}
        </div>
      )}
      {file && (
        <div className="group flex items-center rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg shadow-xs hover:bg-components-panel-on-panel-item-bg-hover">
          <div className="flex items-center justify-center p-3">
            <span aria-hidden className="i-custom-public-files-yaml size-6 shrink-0" />
          </div>
          <div className="flex grow flex-col items-start gap-0.5 py-1 pr-2">
            <span className="max-w-[calc(100%-30px)] overflow-hidden text-[12px] leading-4 font-medium text-ellipsis whitespace-nowrap text-text-secondary">{file.name}</span>
            <div className="flex h-3 items-center gap-1 self-stretch text-[10px] leading-3 font-medium text-text-tertiary uppercase">
              <span>{t('agentDetail.configure.skills.upload.fileType')}</span>
              <span className="text-text-quaternary">·</span>
              <span>{formatFileSize(file.size)}</span>
            </div>
          </div>
          <div className="hidden items-center pr-3 group-hover:flex">
            <ActionButton onClick={() => onChange(undefined)}>
              <span aria-hidden className="i-ri-delete-bin-line size-4 text-text-tertiary" />
            </ActionButton>
          </div>
        </div>
      )}
    </div>
  )
}

export function AgentSkillUploadDialog({
  agentId,
  open,
  onOpenChange,
}: {
  agentId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const [file, setFile] = useState<File>()
  const uploadSkillMutation = useMutation(consoleQuery.apps.byAppId.agent.skills.upload.post.mutationOptions())

  const handleUpload = () => {
    if (!file || uploadSkillMutation.isPending)
      return

    uploadSkillMutation.mutate({
      params: {
        app_id: agentId,
      },
      body: {
        file,
      },
    }, {
      onSuccess: () => {
        toast.success(t('agentDetail.configure.skills.upload.success'))
        setFile(undefined)
        onOpenChange(false)
      },
      onError: () => {
        toast.error(t('agentDetail.configure.skills.upload.failed'))
      },
    })
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      uploadSkillMutation.reset()
      setFile(undefined)
    }
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogCloseButton />
        <DialogTitle className="title-2xl-semi-bold text-text-primary">
          {t('agentDetail.configure.skills.upload.title')}
        </DialogTitle>
        <DialogDescription className="mt-1 system-sm-regular text-text-tertiary">
          {t('agentDetail.configure.skills.upload.description')}
        </DialogDescription>
        <AgentSkillPackageUploader
          file={file}
          onChange={setFile}
        />
        <div className="flex justify-end gap-2 pt-6">
          <Button type="button" onClick={() => handleOpenChange(false)} disabled={uploadSkillMutation.isPending}>
            {tCommon('operation.cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!file}
            loading={uploadSkillMutation.isPending}
            onClick={handleUpload}
          >
            {t('agentDetail.configure.skills.upload.action')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
