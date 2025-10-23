const translation = {
  creation: {
    createFromScratch: {
      title: 'Pipeline de conhecimento em branco',
      description: 'Crie um pipeline personalizado do zero com controle total sobre o processamento e a estrutura de dados.',
    },
    backToKnowledge: 'Voltar ao Conhecimento',
    successTip: 'Criou com sucesso uma Base de Dados de Conhecimento',
    createKnowledge: 'Criar conhecimento',
    errorTip: 'Falha ao criar uma base de dados de conhecimento',
    importDSL: 'Importar de um arquivo DSL',
    caution: 'Cuidado',
  },
  templates: {
    customized: 'Personalizado',
  },
  operations: {
    process: 'Processo',
    details: 'Detalhes',
    preview: 'Visualizar',
    convert: 'Converter',
    exportPipeline: 'Pipeline de exportação',
    useTemplate: 'Usar este Pipeline de Conhecimento',
    editInfo: 'Editar informações',
    choose: 'Escolher',
    saveAndProcess: 'Salvar & Processar',
    dataSource: 'Fonte de dados',
    backToDataSource: 'Voltar para a fonte de dados',
  },
  deletePipeline: {
    title: 'Tem certeza de que deseja excluir este modelo de pipeline?',
    content: 'A exclusão do modelo de pipeline é irreversível.',
  },
  publishPipeline: {
    success: {
      message: 'Pipeline de conhecimento publicado',
    },
    error: {
      message: 'Falha ao publicar o pipeline de conhecimento',
    },
  },
  publishTemplate: {
    success: {
      learnMore: 'Saiba Mais',
      message: 'Modelo de pipeline publicado',
      tip: 'Você pode usar este modelo na página de criação.',
    },
    error: {
      message: 'Falha ao publicar o modelo de pipeline',
    },
  },
  exportDSL: {
    errorTip: 'Falha ao exportar DSL de pipeline',
    successTip: 'Exportar DSL de pipeline com êxito',
  },
  details: {
    structure: 'Estrutura',
    structureTooltip: 'A Estrutura de Partes determina como os documentos são divididos e indexados, oferecendo os modos Geral, Pai-Filho e P e Resposta, e é exclusiva para cada base de conhecimento.',
  },
  testRun: {
    steps: {
      dataSource: 'Fonte de dados',
      documentProcessing: 'Processamento de documentos',
    },
    dataSource: {
      localFiles: 'Arquivos locais',
    },
    notion: {
      title: 'Escolher páginas do Notion',
      docTitle: 'Documentos do Notion',
    },
    title: 'Execução de teste',
    tooltip: 'No modo de execução de teste, apenas um documento pode ser importado por vez para facilitar a depuração e a observação.',
  },
  inputFieldPanel: {
    uniqueInputs: {
      title: 'Entradas exclusivas para cada entrada',
      tooltip: 'As entradas exclusivas só podem ser acessadas pela fonte de dados selecionada e seus nós downstream. Os usuários não precisarão preenchê-lo ao escolher outras fontes de dados. Somente os campos de entrada referenciados por variáveis de fonte de dados aparecerão na primeira etapa (Fonte de dados). Todos os outros campos serão mostrados na segunda etapa (Processar documentos).',
    },
    globalInputs: {
      title: 'Entradas globais para todas as entradas',
      tooltip: 'As entradas globais são compartilhadas entre todos os nós. Os usuários precisarão preenchê-los ao selecionar qualquer fonte de dados. Por exemplo, campos como delimitador e comprimento máximo do bloco podem ser aplicados uniformemente em várias fontes de dados. Somente os campos de entrada referenciados por variáveis de fonte de dados aparecem na primeira etapa (fonte de dados). Todos os outros campos aparecem na segunda etapa (Processar documentos).',
    },
    preview: {
      stepTwoTitle: 'Documentos de processo',
      stepOneTitle: 'Fonte de dados',
    },
    error: {
      variableDuplicate: 'O nome da variável já existe. Por favor, escolha um nome diferente.',
    },
    addInputField: 'Adicionar campo de entrada',
    editInputField: 'Editar campo de entrada',
    title: 'Campos de entrada do usuário',
    description: 'Os campos de entrada do usuário são usados para definir e coletar variáveis necessárias durante o processo de execução do pipeline. Os usuários podem personalizar o tipo de campo e configurar de forma flexível o valor de entrada para atender às necessidades de diferentes fontes de dados ou etapas de processamento de documentos.',
  },
  addDocuments: {
    steps: {
      processDocuments: 'Documentos de processo',
      processingDocuments: 'Processamento de documentos',
      chooseDatasource: 'Escolher uma fonte de dados',
    },
    stepOne: {
      preview: 'Visualizar',
    },
    stepTwo: {
      chunkSettings: 'Configurações de partes',
      previewChunks: 'Visualizar partes',
    },
    stepThree: {
      learnMore: 'Saiba Mais',
    },
    characters: 'Caracteres',
    title: 'Adicionar documentos',
    backToDataSource: 'Fonte de dados',
  },
  documentSettings: {
    title: 'Configurações do documento',
  },
  onlineDocument: {},
  onlineDrive: {
    breadcrumbs: {
      searchPlaceholder: 'Pesquisar arquivos...',
      allFiles: 'Todos os arquivos',
      allBuckets: 'Todos os buckets do Cloud Storage',
    },
    resetKeywords: 'Redefinir palavras-chave',
    notSupportedFileType: 'Este tipo de arquivo não é suportado',
    emptyFolder: 'Esta pasta está vazia',
    emptySearchResult: 'Nenhum item foi encontrado',
  },
  credentialSelector: {},
  conversion: {
    confirm: {
      title: 'Confirmação',
      content: 'Esta ação é permanente. Você não poderá reverter para o método anterior. Por favor, confirme para converter.',
    },
    errorMessage: 'Falha ao converter o conjunto de dados em um pipeline',
    warning: 'Esta ação não pode ser desfeita.',
    descriptionChunk2: '— uma abordagem mais aberta e flexível com acesso a plugins do nosso mercado. Isso aplicará o novo método de processamento a todos os documentos futuros.',
    successMessage: 'Converteu com êxito o conjunto de dados em um pipeline',
    title: 'Converter em pipeline de conhecimento',
    descriptionChunk1: 'Agora você pode converter sua base de conhecimento existente para usar o Pipeline de Conhecimento para processamento de documentos',
  },
  knowledgeNameAndIconPlaceholder: 'Insira o nome da Base de Conhecimento',
  knowledgeDescription: 'Descrição do conhecimento',
  knowledgePermissions: 'Permissões',
  pipelineNameAndIcon: 'Nome e ícone do pipeline',
  inputField: 'Campo de entrada',
  knowledgeNameAndIcon: 'Nome e ícone do conhecimento',
  editPipelineInfo: 'Editar informações do pipeline',
  knowledgeDescriptionPlaceholder: 'Descreva o que está nesta Base de Conhecimento. Uma descrição detalhada permite que a IA acesse o conteúdo do conjunto de dados com mais precisão. Se estiver vazio, o Dify usará a estratégia de acerto padrão. (Opcional)',
}

export default translation
