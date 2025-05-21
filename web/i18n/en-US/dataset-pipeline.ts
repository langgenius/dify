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
    structure: 'Structure',
    structureTooltip: 'Chunk Structure determines how documents are split and indexed—offering General, Parent-Child, and Q&A modes—and is unique to each knowledge base.',
  },
  testRun: {
    title: 'Test Run',
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
    sharedInputs: {
      title: 'Shared Inputs',
      tooltip: 'Shared Inputs are available to all downstream nodes across data sources. For example, variables like delimiter and maximum chunk length can be uniformly applied when processing documents from multiple sources.',
    },
    addInputField: 'Add Input Field',
    editInputField: 'Edit Input Field',
  },
  addDocuments: {
    title: 'Add Documents',
    steps: {
      chooseDatasource: 'Choose a Data Source',
      processDocuments: 'Process Documents',
      processingDocuments: 'Processing Documents',
    },
    backToDataSource: 'Data Source',
  },
}

export default translation
