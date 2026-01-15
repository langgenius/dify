'use client'
import type { DocType } from '@/models/datasets'
import type { I18nKeysByPrefix } from '@/types/i18n'
import { useTranslation } from 'react-i18next'
import useTimestamp from '@/hooks/use-timestamp'
import { ChunkingMode } from '@/models/datasets'
import { formatFileSize, formatNumber, formatTime } from '@/utils/format'

export type inputType = 'input' | 'select' | 'textarea'
export type metadataType = DocType | 'originInfo' | 'technicalParameters'

type MetadataMap
  = Record<
    metadataType,
    {
      text: string
      allowEdit?: boolean
      icon?: React.ReactNode
      iconName?: string
      subFieldsMap: Record<
        string,
        {
          label: string
          inputType?: inputType
          field?: string
          render?: (value: any, total?: number) => React.ReactNode | string
        }
      >
    }
  >

const fieldPrefix = 'metadata.field'

export const useMetadataMap = (): MetadataMap => {
  const { t } = useTranslation()
  const { formatTime: formatTimestamp } = useTimestamp()

  return {
    book: {
      text: t('metadata.type.book', { ns: 'datasetDocuments' }),
      iconName: 'bookOpen',
      subFieldsMap: {
        title: { label: t(`${fieldPrefix}.book.title`, { ns: 'datasetDocuments' }) },
        language: {
          label: t(`${fieldPrefix}.book.language`, { ns: 'datasetDocuments' }),
          inputType: 'select',
        },
        author: { label: t(`${fieldPrefix}.book.author`, { ns: 'datasetDocuments' }) },
        publisher: { label: t(`${fieldPrefix}.book.publisher`, { ns: 'datasetDocuments' }) },
        publication_date: { label: t(`${fieldPrefix}.book.publicationDate`, { ns: 'datasetDocuments' }) },
        isbn: { label: t(`${fieldPrefix}.book.ISBN`, { ns: 'datasetDocuments' }) },
        category: {
          label: t(`${fieldPrefix}.book.category`, { ns: 'datasetDocuments' }),
          inputType: 'select',
        },
      },
    },
    web_page: {
      text: t('metadata.type.webPage', { ns: 'datasetDocuments' }),
      iconName: 'globe',
      subFieldsMap: {
        'title': { label: t(`${fieldPrefix}.webPage.title`, { ns: 'datasetDocuments' }) },
        'url': { label: t(`${fieldPrefix}.webPage.url`, { ns: 'datasetDocuments' }) },
        'language': {
          label: t(`${fieldPrefix}.webPage.language`, { ns: 'datasetDocuments' }),
          inputType: 'select',
        },
        'author/publisher': { label: t(`${fieldPrefix}.webPage.authorPublisher`, { ns: 'datasetDocuments' }) },
        'publish_date': { label: t(`${fieldPrefix}.webPage.publishDate`, { ns: 'datasetDocuments' }) },
        'topic/keywords': { label: t(`${fieldPrefix}.webPage.topicKeywords`, { ns: 'datasetDocuments' }) },
        'description': { label: t(`${fieldPrefix}.webPage.description`, { ns: 'datasetDocuments' }) },
      },
    },
    paper: {
      text: t('metadata.type.paper', { ns: 'datasetDocuments' }),
      iconName: 'graduationHat',
      subFieldsMap: {
        'title': { label: t(`${fieldPrefix}.paper.title`, { ns: 'datasetDocuments' }) },
        'language': {
          label: t(`${fieldPrefix}.paper.language`, { ns: 'datasetDocuments' }),
          inputType: 'select',
        },
        'author': { label: t(`${fieldPrefix}.paper.author`, { ns: 'datasetDocuments' }) },
        'publish_date': { label: t(`${fieldPrefix}.paper.publishDate`, { ns: 'datasetDocuments' }) },
        'journal/conference_name': {
          label: t(`${fieldPrefix}.paper.journalConferenceName`, { ns: 'datasetDocuments' }),
        },
        'volume/issue/page_numbers': { label: t(`${fieldPrefix}.paper.volumeIssuePage`, { ns: 'datasetDocuments' }) },
        'doi': { label: t(`${fieldPrefix}.paper.DOI`, { ns: 'datasetDocuments' }) },
        'topic/keywords': { label: t(`${fieldPrefix}.paper.topicsKeywords`, { ns: 'datasetDocuments' }) },
        'abstract': {
          label: t(`${fieldPrefix}.paper.abstract`, { ns: 'datasetDocuments' }),
          inputType: 'textarea',
        },
      },
    },
    social_media_post: {
      text: t('metadata.type.socialMediaPost', { ns: 'datasetDocuments' }),
      iconName: 'atSign',
      subFieldsMap: {
        'platform': { label: t(`${fieldPrefix}.socialMediaPost.platform`, { ns: 'datasetDocuments' }) },
        'author/username': {
          label: t(`${fieldPrefix}.socialMediaPost.authorUsername`, { ns: 'datasetDocuments' }),
        },
        'publish_date': { label: t(`${fieldPrefix}.socialMediaPost.publishDate`, { ns: 'datasetDocuments' }) },
        'post_url': { label: t(`${fieldPrefix}.socialMediaPost.postURL`, { ns: 'datasetDocuments' }) },
        'topics/tags': { label: t(`${fieldPrefix}.socialMediaPost.topicsTags`, { ns: 'datasetDocuments' }) },
      },
    },
    personal_document: {
      text: t('metadata.type.personalDocument', { ns: 'datasetDocuments' }),
      iconName: 'file',
      subFieldsMap: {
        'title': { label: t(`${fieldPrefix}.personalDocument.title`, { ns: 'datasetDocuments' }) },
        'author': { label: t(`${fieldPrefix}.personalDocument.author`, { ns: 'datasetDocuments' }) },
        'creation_date': {
          label: t(`${fieldPrefix}.personalDocument.creationDate`, { ns: 'datasetDocuments' }),
        },
        'last_modified_date': {
          label: t(`${fieldPrefix}.personalDocument.lastModifiedDate`, { ns: 'datasetDocuments' }),
        },
        'document_type': {
          label: t(`${fieldPrefix}.personalDocument.documentType`, { ns: 'datasetDocuments' }),
          inputType: 'select',
        },
        'tags/category': {
          label: t(`${fieldPrefix}.personalDocument.tagsCategory`, { ns: 'datasetDocuments' }),
        },
      },
    },
    business_document: {
      text: t('metadata.type.businessDocument', { ns: 'datasetDocuments' }),
      iconName: 'briefcase',
      subFieldsMap: {
        'title': { label: t(`${fieldPrefix}.businessDocument.title`, { ns: 'datasetDocuments' }) },
        'author': { label: t(`${fieldPrefix}.businessDocument.author`, { ns: 'datasetDocuments' }) },
        'creation_date': {
          label: t(`${fieldPrefix}.businessDocument.creationDate`, { ns: 'datasetDocuments' }),
        },
        'last_modified_date': {
          label: t(`${fieldPrefix}.businessDocument.lastModifiedDate`, { ns: 'datasetDocuments' }),
        },
        'document_type': {
          label: t(`${fieldPrefix}.businessDocument.documentType`, { ns: 'datasetDocuments' }),
          inputType: 'select',
        },
        'department/team': {
          label: t(`${fieldPrefix}.businessDocument.departmentTeam`, { ns: 'datasetDocuments' }),
        },
      },
    },
    im_chat_log: {
      text: t('metadata.type.IMChat', { ns: 'datasetDocuments' }),
      iconName: 'messageTextCircle',
      subFieldsMap: {
        'chat_platform': { label: t(`${fieldPrefix}.IMChat.chatPlatform`, { ns: 'datasetDocuments' }) },
        'chat_participants/group_name': {
          label: t(`${fieldPrefix}.IMChat.chatPartiesGroupName`, { ns: 'datasetDocuments' }),
        },
        'start_date': { label: t(`${fieldPrefix}.IMChat.startDate`, { ns: 'datasetDocuments' }) },
        'end_date': { label: t(`${fieldPrefix}.IMChat.endDate`, { ns: 'datasetDocuments' }) },
        'participants': { label: t(`${fieldPrefix}.IMChat.participants`, { ns: 'datasetDocuments' }) },
        'topicKeywords': {
          label: t(`${fieldPrefix}.IMChat.topicsKeywords`, { ns: 'datasetDocuments' }),
          inputType: 'textarea',
        },
        'fileType': { label: t(`${fieldPrefix}.IMChat.fileType`, { ns: 'datasetDocuments' }) },
      },
    },
    wikipedia_entry: {
      text: t('metadata.type.wikipediaEntry', { ns: 'datasetDocuments' }),
      allowEdit: false,
      subFieldsMap: {
        'title': { label: t(`${fieldPrefix}.wikipediaEntry.title`, { ns: 'datasetDocuments' }) },
        'language': {
          label: t(`${fieldPrefix}.wikipediaEntry.language`, { ns: 'datasetDocuments' }),
          inputType: 'select',
        },
        'web_page_url': { label: t(`${fieldPrefix}.wikipediaEntry.webpageURL`, { ns: 'datasetDocuments' }) },
        'editor/contributor': {
          label: t(`${fieldPrefix}.wikipediaEntry.editorContributor`, { ns: 'datasetDocuments' }),
        },
        'last_edit_date': {
          label: t(`${fieldPrefix}.wikipediaEntry.lastEditDate`, { ns: 'datasetDocuments' }),
        },
        'summary/introduction': {
          label: t(`${fieldPrefix}.wikipediaEntry.summaryIntroduction`, { ns: 'datasetDocuments' }),
          inputType: 'textarea',
        },
      },
    },
    synced_from_notion: {
      text: t('metadata.type.notion', { ns: 'datasetDocuments' }),
      allowEdit: false,
      subFieldsMap: {
        'title': { label: t(`${fieldPrefix}.notion.title`, { ns: 'datasetDocuments' }) },
        'language': { label: t(`${fieldPrefix}.notion.language`, { ns: 'datasetDocuments' }), inputType: 'select' },
        'author/creator': { label: t(`${fieldPrefix}.notion.author`, { ns: 'datasetDocuments' }) },
        'creation_date': { label: t(`${fieldPrefix}.notion.createdTime`, { ns: 'datasetDocuments' }) },
        'last_modified_date': {
          label: t(`${fieldPrefix}.notion.lastModifiedTime`, { ns: 'datasetDocuments' }),
        },
        'notion_page_link': { label: t(`${fieldPrefix}.notion.url`, { ns: 'datasetDocuments' }) },
        'category/tags': { label: t(`${fieldPrefix}.notion.tag`, { ns: 'datasetDocuments' }) },
        'description': { label: t(`${fieldPrefix}.notion.description`, { ns: 'datasetDocuments' }) },
      },
    },
    synced_from_github: {
      text: t('metadata.type.github', { ns: 'datasetDocuments' }),
      allowEdit: false,
      subFieldsMap: {
        'repository_name': { label: t(`${fieldPrefix}.github.repoName`, { ns: 'datasetDocuments' }) },
        'repository_description': { label: t(`${fieldPrefix}.github.repoDesc`, { ns: 'datasetDocuments' }) },
        'repository_owner/organization': { label: t(`${fieldPrefix}.github.repoOwner`, { ns: 'datasetDocuments' }) },
        'code_filename': { label: t(`${fieldPrefix}.github.fileName`, { ns: 'datasetDocuments' }) },
        'code_file_path': { label: t(`${fieldPrefix}.github.filePath`, { ns: 'datasetDocuments' }) },
        'programming_language': { label: t(`${fieldPrefix}.github.programmingLang`, { ns: 'datasetDocuments' }) },
        'github_link': { label: t(`${fieldPrefix}.github.url`, { ns: 'datasetDocuments' }) },
        'open_source_license': { label: t(`${fieldPrefix}.github.license`, { ns: 'datasetDocuments' }) },
        'commit_date': { label: t(`${fieldPrefix}.github.lastCommitTime`, { ns: 'datasetDocuments' }) },
        'commit_author': {
          label: t(`${fieldPrefix}.github.lastCommitAuthor`, { ns: 'datasetDocuments' }),
        },
      },
    },
    originInfo: {
      text: '',
      allowEdit: false,
      subFieldsMap: {
        'name': { label: t(`${fieldPrefix}.originInfo.originalFilename`, { ns: 'datasetDocuments' }) },
        'data_source_info.upload_file.size': {
          label: t(`${fieldPrefix}.originInfo.originalFileSize`, { ns: 'datasetDocuments' }),
          render: value => formatFileSize(value),
        },
        'created_at': {
          label: t(`${fieldPrefix}.originInfo.uploadDate`, { ns: 'datasetDocuments' }),
          render: value => formatTimestamp(value, t('metadata.dateTimeFormat', { ns: 'datasetDocuments' }) as string),
        },
        'completed_at': {
          label: t(`${fieldPrefix}.originInfo.lastUpdateDate`, { ns: 'datasetDocuments' }),
          render: value => formatTimestamp(value, t('metadata.dateTimeFormat', { ns: 'datasetDocuments' }) as string),
        },
        'data_source_type': {
          label: t(`${fieldPrefix}.originInfo.source`, { ns: 'datasetDocuments' }),
          render: (value: I18nKeysByPrefix<'datasetDocuments', 'metadata.source.'> | 'notion_import') => t(`metadata.source.${value === 'notion_import' ? 'notion' : value}`, { ns: 'datasetDocuments' }),
        },
      },
    },
    technicalParameters: {
      text: t('metadata.type.technicalParameters', { ns: 'datasetDocuments' }),
      allowEdit: false,
      subFieldsMap: {
        'doc_form': {
          label: t(`${fieldPrefix}.technicalParameters.segmentSpecification`, { ns: 'datasetDocuments' }),
          render: (value) => {
            if (value === ChunkingMode.text)
              return t('chunkingMode.general', { ns: 'dataset' })
            if (value === ChunkingMode.qa)
              return t('chunkingMode.qa', { ns: 'dataset' })
            if (value === ChunkingMode.parentChild)
              return t('chunkingMode.parentChild', { ns: 'dataset' })
            return '--'
          },
        },
        'dataset_process_rule.rules.segmentation.max_tokens': {
          label: t(`${fieldPrefix}.technicalParameters.segmentLength`, { ns: 'datasetDocuments' }),
          render: value => formatNumber(value),
        },
        'average_segment_length': {
          label: t(`${fieldPrefix}.technicalParameters.avgParagraphLength`, { ns: 'datasetDocuments' }),
          render: value => `${formatNumber(value)} characters`,
        },
        'segment_count': {
          label: t(`${fieldPrefix}.technicalParameters.paragraphs`, { ns: 'datasetDocuments' }),
          render: value => `${formatNumber(value)} paragraphs`,
        },
        'hit_count': {
          label: t(`${fieldPrefix}.technicalParameters.hitCount`, { ns: 'datasetDocuments' }),
          render: (value, total) => {
            const v = value || 0
            return `${!total ? 0 : ((v / total) * 100).toFixed(2)}% (${v}/${total})`
          },
        },
        'indexing_latency': {
          label: t(`${fieldPrefix}.technicalParameters.embeddingTime`, { ns: 'datasetDocuments' }),
          render: value => formatTime(value),
        },
        'tokens': {
          label: t(`${fieldPrefix}.technicalParameters.embeddedSpend`, { ns: 'datasetDocuments' }),
          render: value => `${formatNumber(value)} tokens`,
        },
      },
    },
  }
}

const langPrefix = 'metadata.languageMap.'

export const useLanguages = () => {
  const { t } = useTranslation()
  return {
    zh: t(`${langPrefix}zh`, { ns: 'datasetDocuments' }),
    en: t(`${langPrefix}en`, { ns: 'datasetDocuments' }),
    es: t(`${langPrefix}es`, { ns: 'datasetDocuments' }),
    fr: t(`${langPrefix}fr`, { ns: 'datasetDocuments' }),
    de: t(`${langPrefix}de`, { ns: 'datasetDocuments' }),
    ja: t(`${langPrefix}ja`, { ns: 'datasetDocuments' }),
    ko: t(`${langPrefix}ko`, { ns: 'datasetDocuments' }),
    ru: t(`${langPrefix}ru`, { ns: 'datasetDocuments' }),
    ar: t(`${langPrefix}ar`, { ns: 'datasetDocuments' }),
    pt: t(`${langPrefix}pt`, { ns: 'datasetDocuments' }),
    it: t(`${langPrefix}it`, { ns: 'datasetDocuments' }),
    nl: t(`${langPrefix}nl`, { ns: 'datasetDocuments' }),
    pl: t(`${langPrefix}pl`, { ns: 'datasetDocuments' }),
    sv: t(`${langPrefix}sv`, { ns: 'datasetDocuments' }),
    tr: t(`${langPrefix}tr`, { ns: 'datasetDocuments' }),
    he: t(`${langPrefix}he`, { ns: 'datasetDocuments' }),
    hi: t(`${langPrefix}hi`, { ns: 'datasetDocuments' }),
    da: t(`${langPrefix}da`, { ns: 'datasetDocuments' }),
    fi: t(`${langPrefix}fi`, { ns: 'datasetDocuments' }),
    no: t(`${langPrefix}no`, { ns: 'datasetDocuments' }),
    hu: t(`${langPrefix}hu`, { ns: 'datasetDocuments' }),
    el: t(`${langPrefix}el`, { ns: 'datasetDocuments' }),
    cs: t(`${langPrefix}cs`, { ns: 'datasetDocuments' }),
    th: t(`${langPrefix}th`, { ns: 'datasetDocuments' }),
    id: t(`${langPrefix}id`, { ns: 'datasetDocuments' }),
    ro: t(`${langPrefix}ro`, { ns: 'datasetDocuments' }),
  }
}

const bookCategoryPrefix = 'metadata.categoryMap.book.'

export const useBookCategories = () => {
  const { t } = useTranslation()
  return {
    fiction: t(`${bookCategoryPrefix}fiction`, { ns: 'datasetDocuments' }),
    biography: t(`${bookCategoryPrefix}biography`, { ns: 'datasetDocuments' }),
    history: t(`${bookCategoryPrefix}history`, { ns: 'datasetDocuments' }),
    science: t(`${bookCategoryPrefix}science`, { ns: 'datasetDocuments' }),
    technology: t(`${bookCategoryPrefix}technology`, { ns: 'datasetDocuments' }),
    education: t(`${bookCategoryPrefix}education`, { ns: 'datasetDocuments' }),
    philosophy: t(`${bookCategoryPrefix}philosophy`, { ns: 'datasetDocuments' }),
    religion: t(`${bookCategoryPrefix}religion`, { ns: 'datasetDocuments' }),
    socialSciences: t(`${bookCategoryPrefix}socialSciences`, { ns: 'datasetDocuments' }),
    art: t(`${bookCategoryPrefix}art`, { ns: 'datasetDocuments' }),
    travel: t(`${bookCategoryPrefix}travel`, { ns: 'datasetDocuments' }),
    health: t(`${bookCategoryPrefix}health`, { ns: 'datasetDocuments' }),
    selfHelp: t(`${bookCategoryPrefix}selfHelp`, { ns: 'datasetDocuments' }),
    businessEconomics: t(`${bookCategoryPrefix}businessEconomics`, { ns: 'datasetDocuments' }),
    cooking: t(`${bookCategoryPrefix}cooking`, { ns: 'datasetDocuments' }),
    childrenYoungAdults: t(`${bookCategoryPrefix}childrenYoungAdults`, { ns: 'datasetDocuments' }),
    comicsGraphicNovels: t(`${bookCategoryPrefix}comicsGraphicNovels`, { ns: 'datasetDocuments' }),
    poetry: t(`${bookCategoryPrefix}poetry`, { ns: 'datasetDocuments' }),
    drama: t(`${bookCategoryPrefix}drama`, { ns: 'datasetDocuments' }),
    other: t(`${bookCategoryPrefix}other`, { ns: 'datasetDocuments' }),
  }
}

const personalDocCategoryPrefix
  = 'metadata.categoryMap.personalDoc.'

export const usePersonalDocCategories = () => {
  const { t } = useTranslation()
  return {
    notes: t(`${personalDocCategoryPrefix}notes`, { ns: 'datasetDocuments' }),
    blogDraft: t(`${personalDocCategoryPrefix}blogDraft`, { ns: 'datasetDocuments' }),
    diary: t(`${personalDocCategoryPrefix}diary`, { ns: 'datasetDocuments' }),
    researchReport: t(`${personalDocCategoryPrefix}researchReport`, { ns: 'datasetDocuments' }),
    bookExcerpt: t(`${personalDocCategoryPrefix}bookExcerpt`, { ns: 'datasetDocuments' }),
    schedule: t(`${personalDocCategoryPrefix}schedule`, { ns: 'datasetDocuments' }),
    list: t(`${personalDocCategoryPrefix}list`, { ns: 'datasetDocuments' }),
    projectOverview: t(`${personalDocCategoryPrefix}projectOverview`, { ns: 'datasetDocuments' }),
    photoCollection: t(`${personalDocCategoryPrefix}photoCollection`, { ns: 'datasetDocuments' }),
    creativeWriting: t(`${personalDocCategoryPrefix}creativeWriting`, { ns: 'datasetDocuments' }),
    codeSnippet: t(`${personalDocCategoryPrefix}codeSnippet`, { ns: 'datasetDocuments' }),
    designDraft: t(`${personalDocCategoryPrefix}designDraft`, { ns: 'datasetDocuments' }),
    personalResume: t(`${personalDocCategoryPrefix}personalResume`, { ns: 'datasetDocuments' }),
    other: t(`${personalDocCategoryPrefix}other`, { ns: 'datasetDocuments' }),
  }
}

const businessDocCategoryPrefix
  = 'metadata.categoryMap.businessDoc.'

export const useBusinessDocCategories = () => {
  const { t } = useTranslation()
  return {
    meetingMinutes: t(`${businessDocCategoryPrefix}meetingMinutes`, { ns: 'datasetDocuments' }),
    researchReport: t(`${businessDocCategoryPrefix}researchReport`, { ns: 'datasetDocuments' }),
    proposal: t(`${businessDocCategoryPrefix}proposal`, { ns: 'datasetDocuments' }),
    employeeHandbook: t(`${businessDocCategoryPrefix}employeeHandbook`, { ns: 'datasetDocuments' }),
    trainingMaterials: t(`${businessDocCategoryPrefix}trainingMaterials`, { ns: 'datasetDocuments' }),
    requirementsDocument: t(`${businessDocCategoryPrefix}requirementsDocument`, { ns: 'datasetDocuments' }),
    designDocument: t(`${businessDocCategoryPrefix}designDocument`, { ns: 'datasetDocuments' }),
    productSpecification: t(`${businessDocCategoryPrefix}productSpecification`, { ns: 'datasetDocuments' }),
    financialReport: t(`${businessDocCategoryPrefix}financialReport`, { ns: 'datasetDocuments' }),
    marketAnalysis: t(`${businessDocCategoryPrefix}marketAnalysis`, { ns: 'datasetDocuments' }),
    projectPlan: t(`${businessDocCategoryPrefix}projectPlan`, { ns: 'datasetDocuments' }),
    teamStructure: t(`${businessDocCategoryPrefix}teamStructure`, { ns: 'datasetDocuments' }),
    policiesProcedures: t(`${businessDocCategoryPrefix}policiesProcedures`, { ns: 'datasetDocuments' }),
    contractsAgreements: t(`${businessDocCategoryPrefix}contractsAgreements`, { ns: 'datasetDocuments' }),
    emailCorrespondence: t(`${businessDocCategoryPrefix}emailCorrespondence`, { ns: 'datasetDocuments' }),
    other: t(`${businessDocCategoryPrefix}other`, { ns: 'datasetDocuments' }),
  }
}
