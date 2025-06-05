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
  'html',
]

export const COMMON_OUTPUT = [
  {
    name: 'datasource_type',
    type: VarType.string,
    description: 'local_file, online_document, website_crawl',
  },
]

export const FILE_OUTPUT = [
  {
    name: 'file',
    type: VarType.file,
    description: 'file',
    subItems: [
      {
        name: 'name',
        type: VarType.string,
        description: '',
      },
      {
        name: 'size',
        type: VarType.number,
        description: '',
      },
      {
        name: 'type',
        type: VarType.string,
        description: '',
      },
      {
        name: 'extension',
        type: VarType.string,
        description: '',
      },
      {
        name: 'mime_type',
        type: VarType.string,
        description: '',
      },
      {
        name: 'transfer_method',
        type: VarType.string,
        description: '',
      },
      {
        name: 'url',
        type: VarType.string,
        description: '',
      },
      {
        name: 'related_id',
        type: VarType.string,
        description: '',
      },
    ],
  },
]

export const WEBSITE_OUTPUT = [
  {
    name: 'source_url',
    type: VarType.string,
    description: 'The URL of the crawled website',
  },
  {
    name: 'content',
    type: VarType.string,
    description: 'The content of the crawled website',
  },
  {
    name: 'title',
    type: VarType.string,
    description: 'The title of the crawled website',
  },
  {
    name: 'description',
    type: VarType.string,
    description: 'The description of the crawled website',
  },
]
