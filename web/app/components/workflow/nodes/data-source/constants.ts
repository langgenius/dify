import { VarType } from '@/app/components/workflow/types'

export const DEFAULT_FILE_EXTENSIONS_IN_LOCAL_FILE_DATA_SOURCE = [
  'txt',
  'markdown',
  'mdx',
  'pdf',
  'html',
  'xlsx',
  'xls',
  'vtt',
  'properties',
  'doc',
  'docx',
  'csv',
  'eml',
  'msg',
  'pptx',
  'xml',
  'epub',
  'ppt',
  'md',
]

export const COMMON_OUTPUT = [
  {
    name: 'datasource_type',
    type: VarType.string,
    description: 'local_file, online_document, website_crawl',
  },
]

export const LOCAL_FILE_OUTPUT = [
  {
    name: 'file',
    type: VarType.file,
    description: 'file',
    subItems: [
      {
        name: 'name',
        type: VarType.string,
        description: 'file name',
      },
      {
        name: 'size',
        type: VarType.number,
        description: 'file size',
      },
      {
        name: 'type',
        type: VarType.string,
        description: 'file type',
      },
      {
        name: 'extension',
        type: VarType.string,
        description: 'file extension',
      },
      {
        name: 'mime_type',
        type: VarType.string,
        description: 'file mime type',
      },
      {
        name: 'transfer_method',
        type: VarType.string,
        description: 'file transfer method',
      },
      {
        name: 'url',
        type: VarType.string,
        description: 'file url',
      },
      {
        name: 'related_id',
        type: VarType.string,
        description: 'file related id',
      },
    ],
  },
]
