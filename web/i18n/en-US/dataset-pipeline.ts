const translation = {
  creation: {
    title: 'Create knowledge pipeline',
    createFromScratch: {
      title: 'Create from scratch',
      description: 'Blank knowledge pipeline',
    },
    ImportDSL: {
      title: 'Import',
      description: 'Import from a DSL file',
    },
    createKnowledge: 'Create Knowledge',
    errorTip: 'Failed to create a Knowledge Pipeline',
    successTip: 'Successfully created a Knowledge Pipeline',
  },
  tabs: {
    builtInPipeline: 'Built-in pipeline',
    customized: 'Customized',
  },
  operations: {
    choose: 'Choose',
    details: 'Details',
    editInfo: 'Edit info',
    exportDSL: 'Export DSL',
    useTemplate: 'Use this Knowledge Pipeline',
    backToDataSource: 'Back to Data Source',
    process: 'Process',
    dataSource: 'Data Source',
    saveAndProcess: 'Save & Process',
    preview: 'Preview',
  },
  knowledgeNameAndIcon: 'Knowledge name & icon',
  knowledgeNameAndIconPlaceholder: 'Please enter the name of the Knowledge Base',
  knowledgeDescription: 'Knowledge description',
  knowledgeDescriptionPlaceholder: 'Describe what is in this Knowledge Base. A detailed description allows AI to access the content of the dataset more accurately. If empty, Dify will use the default hit strategy. (Optional)',
  knowledgePermissions: 'Permissions',
  editPipelineInfo: 'Edit pipeline info',
  pipelineNameAndIcon: 'Pipeline name & icon',
  deletePipeline: {
    title: 'Are you sure to delete this pipeline template?',
    content: 'Deleting the pipeline template is irreversible.',
  },
  exportDSL: {
    successTip: 'Export pipeline DSL successfully',
    errorTip: 'Failed to export pipeline DSL',
  },
  details: {
    createdBy: 'By {{author}}',
    structure: 'Structure',
    structureTooltip: 'Chunk Structure determines how documents are split and indexed—offering General, Parent-Child, and Q&A modes—and is unique to each knowledge base.',
  },
  testRun: {
    title: 'Test Run',
    tooltip: 'In test run mode, only one document is allowed to be imported at a time for easier debugging and observation.',
    steps: {
      dataSource: 'Data Source',
      documentProcessing: 'Document Processing',
    },
    dataSource: {
      localFiles: 'Local Files',
    },
    notion: {
      title: 'Choose Notion Pages',
      docTitle: 'Notion docs',
    },
  },
  inputField: 'Input Field',
  inputFieldPanel: {
    title: 'User Input Fields',
    description: 'User input fields are used to define and collect variables required during the pipeline execution process. Users can customize the field type and flexibly configure the input value to meet the needs of different data sources or document processing steps.',
    uniqueInputs: {
      title: 'Unique Inputs for Each Entrance',
      tooltip: 'Unique Inputs are only accessible to the selected data source and its downstream nodes. Users won\'t need to fill it in when choosing other data sources. Only input fields referenced by data source variables will appear in the first step(Data Source). All other fields will be shown in the second step(Process Documents).',
    },
    globalInputs: {
      title: 'Global Inputs for All Entrances',
      tooltip: 'Global Inputs are shared across all nodes. Users will need to fill them in when selecting any data source. For example, fields like delimiter and maximum chunk length can be uniformly applied across multiple data sources. Only input fields referenced by Data Source variables appear in the first step (Data Source). All other fields show up in the second step (Process Documents).',
    },
    addInputField: 'Add Input Field',
    editInputField: 'Edit Input Field',
    preview: {
      stepOneTitle: 'Data Source',
      stepTwoTitle: 'Process Documents',
    },
  },
  addDocuments: {
    title: 'Add Documents',
    steps: {
      chooseDatasource: 'Choose a Data Source',
      processDocuments: 'Process Documents',
      processingDocuments: 'Processing Documents',
    },
    backToDataSource: 'Data Source',
    stepOne: {
      preview: 'Preview',
    },
    stepTwo: {
      chunkSettings: 'Chunk Settings',
      previewChunks: 'Preview Chunks',
    },
    stepThree: {
      learnMore: 'Learn more',
    },
    characters: 'characters',
  },
  documentSettings: {
    title: 'Document Settings',
  },
  onlineDrive: {
    notConnected: '{{name}} is not connected',
    notConnectedTip: 'To sync with {{name}}, connection to {{name}} must be established first.',
    breadcrumbs: {
      allBuckets: 'All Cloud Storage Buckets',
      searchResult: 'Find {{searchResultsLength}} items in "{{folderName}}" folder',
      noSearchResult: 'No items were found',
      resetKeywords: 'Reset keywords',
      searchPlaceholder: 'Search files...',
    },
    notSupportedFileType: 'This file type is not supported',
  },
}

export default translation
