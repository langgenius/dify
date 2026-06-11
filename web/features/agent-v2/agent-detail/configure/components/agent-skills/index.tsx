'use client'

import type { AgentSkillFileNode } from './agent-skill-detail-dialog'
import type { AgentSkill } from './agent-skill-item'
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
import { ConfigureSection } from '../configure-section'
import { defaultAgentFiles, defaultAgentSkills } from '../configured-data'
import { AgentSkillItem } from './agent-skill-item'

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

function getFirstFileId(files: AgentSkillFileNode[]): string | undefined {
  for (const file of files) {
    if (!file.children?.length)
      return file.id

    const childFileId = getFirstFileId(file.children)
    if (childFileId)
      return childFileId
  }
}

const createSkillDetail = (skillName: string, files: AgentSkillFileNode[]) => ({
  description: 'Dify brand executor rules, voice, typography, layout patterns, and visual design system. Use when generating any Dify brand material including web pages, social graphics, presentations, one-pagers, and pitch decks.',
  selectedFileId: getFirstFileId(files),
  files,
  sections: [
    {
      id: 'text-formatting',
      title: '2. Text Formatting',
      items: [
        'Bold is used for emphasis, e.g. Please double-check your username and password when logging in.',
        'Italics can be used for terminology, e.g. We use the React framework for front-end development.',
        'Strikethrough is used for outdated information, e.g. Old version requires manual environment setup.',
        'Code is used for inline code, e.g. Use npm install.',
        'Inline quotes indicate short verbatim phrasing.',
        'Headings should keep the same information hierarchy as the source material and avoid decorative title casing when the content is ordinary body copy.',
        'Use concise link text that describes the destination, and avoid bare URLs unless the URL itself is the thing a user needs to inspect.',
        'When translating technical material, keep command names, package names, environment variables, and file names in their original form.',
      ],
    },
    {
      id: 'paragraph',
      title: 'Paragraph',
      paragraphs: [
        'The capitalization in the phrase “An Open-Source LLM Apps Development Platform” seems mostly correct, but it depends on the specific context in which it is used. If this is a title or a heading, capitalization style may be appropriate. If it appears in body copy, use sentence case for better readability.',
        'For product surfaces, the skill should preserve the source intent while making the final copy easier to scan. Long paragraphs should be broken into compact blocks, but not so aggressively that the original reasoning is lost. Use plain language, keep examples close to the rules they illustrate, and avoid adding marketing claims that are not present in the source material.',
        'When the input mixes product guidance, implementation notes, and design-system constraints, prefer a structured explanation that separates rule, rationale, and example. This makes the output easier for downstream agents to reuse without guessing which parts are mandatory and which parts are contextual advice.',
      ],
    },
    {
      id: 'lists',
      title: '3. Lists',
      items: [
        'Unordered list for project to-do items.',
        'Ordered list for deployment steps.',
        'Keep list copy concise and scannable.',
        'Group related checklist items together so users can complete one workflow before moving to the next.',
        'Use numbered steps when order matters, especially for setup, migration, deployment, and verification procedures.',
        'Use unordered bullets for independent requirements, available options, design constraints, or evidence gathered during review.',
        'Avoid nested lists unless the hierarchy is essential. If a second level is needed, keep the child list short and directly tied to the parent item.',
        'For long operational guidance, end each section with an observable success condition so another agent can verify completion.',
      ],
    },
    {
      id: 'workflow',
      title: '4. Workflow Rules',
      paragraphs: [
        'Before using this skill, inspect the current workspace and identify whether the user is asking for implementation, review, transformation, or diagnosis. The same source files can require very different outputs depending on that workflow.',
        'Prefer existing project primitives and local conventions over introducing a new abstraction. If the target project already provides a dialog, scroll area, file tree, or typography token, compose those pieces directly and keep feature-specific styling at the call site.',
      ],
      items: [
        'Read the nearby owner component before changing behavior.',
        'Keep mock data at the call site until a real backend contract is ready.',
        'Use generated or project-owned contracts when API data becomes available.',
        'Run the narrowest meaningful verification first, then broaden only when the change touches shared behavior.',
      ],
    },
    {
      id: 'quality-bar',
      title: '5. Quality Bar',
      paragraphs: [
        'The skill output should be specific enough that a reviewer can reproduce the reasoning without reading hidden context. It should name the files, inputs, assumptions, and constraints that influenced the answer. When evidence is unavailable, state the gap directly instead of filling it with generic best practices.',
        'For UI output, keep the generated structure aligned with the design system. Do not replace a primitive with a generic div just to make a screenshot look similar. If a primitive cannot express the design, document the exact missing capability before adding feature-local styling.',
      ],
      items: [
        'No hardcoded user-facing copy outside the feature namespace.',
        'No manual overlay portal or z-index override when a design-system overlay exists.',
        'No unbounded content region that can push the dialog outside the viewport.',
        'No file names or labels that can resize the file list card when folders expand.',
      ],
    },
  ],
})

export function AgentSkills({
  agentId,
  skills = defaultAgentSkills,
  files = defaultAgentFiles,
}: {
  agentId: string
  skills?: AgentSkill[]
  files?: AgentSkillFileNode[]
}) {
  const { t } = useTranslation('agentV2')
  const skillsTip = t('agentDetail.configure.skills.tip')
  const skillsListId = 'agent-configure-skills-list'
  const [isUploadOpen, setIsUploadOpen] = useState(false)

  return (
    <>
      <ConfigureSection
        label={t('agentDetail.configure.skills.label')}
        labelId="agent-configure-skills-label"
        panelId={skillsListId}
        tip={skillsTip}
        tipAriaLabel={skillsTip}
        rootClassName="border-b border-divider-subtle pt-4"
        panelContentClassName="flex flex-col gap-1 pb-4"
        actions={(
          <button
            type="button"
            aria-label={t('agentDetail.configure.skills.add')}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
            onClick={() => setIsUploadOpen(true)}
          >
            <span aria-hidden className="i-ri-add-line size-4" />
          </button>
        )}
      >
        {skills.map(skill => (
          <AgentSkillItem
            key={skill.id}
            skill={{
              ...skill,
              detail: createSkillDetail(skill.name, files),
            }}
          />
        ))}
      </ConfigureSection>
      <AgentSkillUploadDialog
        agentId={agentId}
        open={isUploadOpen}
        onOpenChange={setIsUploadOpen}
      />
    </>
  )
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

function toArrayBuffer(bytes: Uint8Array) {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)

  return buffer
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

function AgentSkillPackageUploader({
  file,
  onChange,
}: {
  file?: File
  onChange: (file?: File) => void
}) {
  const { t } = useTranslation('agentV2')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [isPackaging, setIsPackaging] = useState(false)

  const updateFile = (nextFile?: File) => {
    if (!nextFile) {
      onChange(undefined)
      return
    }

    if (!isSupportedSkillPackage(nextFile)) {
      toast.error(t('agentDetail.configure.skills.upload.invalidFile'))
      return
    }

    onChange(nextFile)
  }

  const packageFolder = async (files: File[], folderName?: string) => {
    if (!files.length) {
      toast.error(t('agentDetail.configure.skills.upload.emptyFolder'))
      return
    }

    setIsPackaging(true)
    try {
      const archiveName = `${folderName || files[0]?.webkitRelativePath?.split('/')[0] || 'skill'}.skill`
      onChange(await createSkillArchive(files, archiveName))
    }
    finally {
      setIsPackaging(false)
    }
  }

  const handleFolderChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    packageFolder(files)
  }

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0]
    event.target.value = ''
    updateFile(nextFile)
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
      await packageFolder(files, entries[0]?.name)
      return
    }

    const droppedFiles = Array.from(event.dataTransfer.files)
    if (droppedFiles.length > 1) {
      await packageFolder(droppedFiles)
      return
    }

    updateFile(droppedFiles[0])
  }

  return (
    <div className="mt-6">
      <input
        ref={fileInputRef}
        className="hidden"
        type="file"
        accept={skillPackageAccept}
        onChange={handleFileChange}
      />
      <input
        ref={folderInputRef}
        className="hidden"
        type="file"
        multiple
        onChange={handleFolderChange}
        {...{ directory: '', webkitdirectory: '' }}
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
                <>
                  <button
                    type="button"
                    className="inline cursor-pointer border-none bg-transparent p-0 pl-1 text-left text-text-accent focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {t('agentDetail.configure.skills.upload.browseFile')}
                  </button>
                  <span className="px-1 text-text-quaternary">/</span>
                  <button
                    type="button"
                    className="inline cursor-pointer border-none bg-transparent p-0 text-left text-text-accent focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
                    onClick={() => folderInputRef.current?.click()}
                  >
                    {t('agentDetail.configure.skills.upload.browseFolder')}
                  </button>
                </>
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

function AgentSkillUploadDialog({
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

  const handleFileChange = (nextFile?: File) => {
    if (!nextFile) {
      setFile(undefined)
      return
    }

    if (!isSupportedSkillPackage(nextFile)) {
      toast.error(t('agentDetail.configure.skills.upload.invalidFile'))
      return
    }

    setFile(nextFile)
  }

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
          onChange={handleFileChange}
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
