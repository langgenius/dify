const translation = {
  pageTitle: {
    line1: 'PROMPT',
    line2: 'Engineering',
  },
  promptMode: {
    simple: 'Switch to Expert Mode to edit the whole PROMPT',
    advanced: 'Expert Mode',
    switchBack: 'Switch back',
    advancedWarning: {
      title:
        'You have switched to Expert Mode, and once you modify the PROMPT, you CANNOT return to the basic mode.',
      description: 'In Expert Mode, you can edit whole PROMPT.',
      learnMore: 'Learn more',
      ok: 'OK',
    },
    operation: {
      addMessage: 'Add Message',
    },
    contextMissing:
      'Context component missed, the effectiveness of the prompt may not be good.',
  },
  operation: {
    applyConfig: 'Publish',
    resetConfig: 'Reset',
    debugConfig: 'Debug',
    addFeature: 'Add Feature',
    automatic: 'Automatic',
    stopResponding: 'Stop responding',
    agree: 'like',
    disagree: 'dislike',
    cancelAgree: 'Cancel like',
    cancelDisagree: 'Cancel dislike',
    userAction: 'User ',
  },
  notSetAPIKey: {
    title: 'LLM provider key has not been set',
    trailFinished: 'Trail finished',
    description:
      'The LLM provider key has not been set, and it needs to be set before debugging.',
    settingBtn: 'Go to settings',
  },
  trailUseGPT4Info: {
    title: 'Does not support gpt-4 now',
    description: 'Use gpt-4, please set API Key.',
  },
  feature: {
    groupChat: {
      title: 'Chat enhance',
      description:
        'Add pre-conversation settings for apps can enhance user experience.',
    },
    groupExperience: {
      title: 'Experience enhance',
    },
    conversationOpener: {
      title: 'Conversation remakers',
      description:
        'In a chat app, the first sentence that the AI actively speaks to the user is usually used as a welcome.',
    },
    suggestedQuestionsAfterAnswer: {
      title: 'Follow-up',
      description:
        'Setting up next questions suggestion can give users a better chat.',
      resDes: '3 suggestions for user next question.',
      tryToAsk: 'Try to ask',
    },
    moreLikeThis: {
      title: 'More like this',
      description:
        'Generate multiple texts at once, and then edit and continue to generate',
      generateNumTip: 'Number of each generated times',
      tip: 'Using this feature will incur additional tokens overhead',
    },
    speechToText: {
      title: 'Speech to Text',
      description: 'Once enabled, you can use voice input.',
      resDes: 'Voice input is enabled',
    },
    citation: {
      title: 'Citations and Attributions',
      description:
        'Once enabled, show source document and attributed section of the generated content.',
      resDes: 'Citations and Attributions is enabled',
    },
    annotation: {
      title: 'Annotation Reply',
      description:
        'You can manually add high-quality response to the cache for prioritized matching with similar user questions.',
      resDes: 'Annotation Response is enabled',
      scoreThreshold: {
        title: 'Score Threshold',
        description:
          'Used to set the similarity threshold for annotation reply.',
        easyMatch: 'Easy Match',
        accurateMatch: 'Accurate Match',
      },
      matchVariable: {
        title: 'Match Variable',
        choosePlaceholder: 'Choose match variable',
      },
      cacheManagement: 'Annotations',
      cached: 'Annotated',
      remove: 'Remove',
      removeConfirm: 'Delete this annotation ?',
      add: 'Add annotation',
      edit: 'Edit annotation',
    },
    dataSet: {
      title: 'Context',
      noData: 'You can import Knowledge as context',
      words: 'Words',
      textBlocks: 'Text Blocks',
      selectTitle: 'Select reference Knowledge',
      selected: 'Knowledge selected',
      noDataSet: 'No Knowledge found',
      toCreate: 'Ir para criar',
      notSupportSelectMulti: 'Atualmente, suporta apenas um conhecimento',
      queryVariable: {
        title: 'Variável de consulta',
        tip: 'Esta variável será usada como entrada de consulta para recuperação de contexto, obtendo informações de contexto relacionadas à entrada desta variável.',
        choosePlaceholder: 'Escolha a variável de consulta',
        noVar: 'Sem variáveis',
        noVarTip: 'por favor, crie uma variável na seção Variáveis',
        unableToQueryDataSet: 'Não é possível consultar o conhecimento',
        unableToQueryDataSetTip:
          'Não é possível consultar o conhecimento com sucesso, escolha uma variável de consulta de contexto na seção de contexto.',
        ok: 'OK',
        contextVarNotEmpty:
          'variável de consulta de contexto não pode estar vazia',
        deleteContextVarTitle: 'Excluir variável "{{varName}}"?',
        deleteContextVarTip:
          'Esta variável foi definida como uma variável de consulta de contexto e removê-la afetará o uso normal do conhecimento. Se você ainda precisa excluí-lo, selecione-o novamente na seção de contexto.',
      },
    },
    tools: {
      title: 'Ferramentas',
      tips: 'As ferramentas fornecem um método de chamada de API padrão, usando a entrada do usuário ou variáveis como parâmetros de solicitação para consultar dados externos como contexto.',
      toolsInUse: '{{count}} ferramentas em uso',
      modal: {
        title: 'Ferramenta',
        toolType: {
          title: 'Tipo de ferramenta',
          placeholder: 'Selecione o tipo de ferramenta',
        },
        name: {
          title: 'Nome',
          placeholder: 'Digite o nome',
        },
        variableName: {
          title: 'Nome da variável',
          placeholder: 'Digite o nome da variável',
        },
      },
    },
    conversationHistory: {
      title: 'Histórico de conversas',
      description: 'Defina nomes de prefixo para os papéis da conversa',
      tip: 'O Histórico de Conversas não está habilitado, adicione <histories> na prompt acima.',
      learnMore: 'Saiba mais',
      editModal: {
        title: 'Editar nomes de papéis de conversa',
        userPrefix: 'Prefixo do usuário',
        assistantPrefix: 'Prefixo do assistente',
      },
    },
    toolbox: {
      title: 'CAIXA DE FERRAMENTAS',
    },
    moderation: {
      title: 'Moderação de conteúdo',
      description:
        'Proteja a saída do modelo usando a API de moderação ou mantendo uma lista de palavras sensíveis.',
      allEnabled: 'Conteúdo de ENTRADA/SAÍDA habilitado',
      inputEnabled: 'Conteúdo de ENTRADA habilitado',
      outputEnabled: 'Conteúdo de SAÍDA habilitado',
      modal: {
        title: 'Configurações de moderação de conteúdo',
        provider: {
          title: 'Provedor',
          openai: 'Moderação OpenAI',
          openaiTip: {
            prefix:
              'A moderação OpenAI requer uma chave de API OpenAI configurada em ',
            suffix: '.',
          },
          keywords: 'Palavras-chave',
        },
        keywords: {
          tip: 'Uma por linha, separadas por quebras de linha. Até 100 caracteres por linha.',
          placeholder: 'Uma por linha, separadas por quebras de linha',
          line: 'Linha',
        },
        content: {
          input: 'Moderar conteúdo de ENTRADA',
          output: 'Moderar conteúdo de SAÍDA',
          preset: 'Respostas predefinidas',
          placeholder: 'Insira o conteúdo das respostas predefinidas aqui',
          condition:
            'Pelo menos uma opção de moderar conteúdo de ENTRADA e SAÍDA está habilitada',
          fromApi: 'As respostas predefinidas são retornadas pela API',
          errorMessage: 'As respostas predefinidas não podem estar vazias',
          supportMarkdown: 'Suporte a Markdown',
        },
        openaiNotConfig: {
          before:
            'A moderação OpenAI requer uma chave de API OpenAI configurada em ',
          after: '',
        },
      },
    },
  },
  automatic: {
    title: 'Orquestração automatizada de aplicativos',
    description:
      'Descreva seu cenário, o Dify orquestrará um aplicativo para você.',
    intendedAudience: 'Quem é o público-alvo?',
    intendedAudiencePlaceHolder: 'por exemplo, Estudante',
    solveProblem: 'Quais problemas eles esperam que a IA resolva para eles?',
    solveProblemPlaceHolder: 'por exemplo, Avaliar o desempenho acadêmico',
    generate: 'Gerar',
    audiencesRequired: 'Público-alvo obrigatório',
    problemRequired: 'Problema obrigatório',
    resTitle: 'Orquestramos o seguinte aplicativo para você.',
    apply: 'Aplicar esta orquestração',
    noData:
      'Descreva seu caso de uso à esquerda, a visualização da orquestração será exibida aqui.',
    loading: 'Orquestrando o aplicativo para você...',
    overwriteTitle: 'Substituir configuração existente?',
    overwriteMessage:
      'Aplicar esta orquestração substituirá a configuração existente.',
  },
  resetConfig: {
    title: 'Confirmar redefinição?',
    message:
      'A redefinição descarta as alterações, restaurando a última configuração publicada.',
  },
  errorMessage: {
    nameOfKeyRequired: 'nome da chave: {{key}} obrigatório',
    valueOfVarRequired: 'valor de {{key}} não pode estar vazio',
    queryRequired: 'O texto da solicitação é obrigatório.',
    waitForResponse: 'Aguarde a resposta à mensagem anterior ser concluída.',
    waitForBatchResponse: 'Aguarde a resposta à tarefa em lote ser concluída.',
    notSelectModel: 'Por favor, escolha um modelo',
    waitForImgUpload: 'Aguarde o upload da imagem',
  },
  chatSubTitle: 'Pré-Prompt',
  completionSubTitle: 'Prefixo Prompt',
  promptTip:
    'Prompts guiam as respostas da IA com instruções e restrições. Insira variáveis como {{input}}. Este prompt não será visível para os usuários.',
  formattingChangedTitle: 'Formatação alterada',
  formattingChangedText:
    'Modificar a formatação redefinirá a área de depuração, você tem certeza?',
  variableTitle: 'Variáveis',
  variableTip:
    'Os usuários preenchem as variáveis em um formulário, substituindo automaticamente as variáveis no prompt.',
  notSetVar:
    'As variáveis permitem que os usuários introduzam palavras de prompt ou observações iniciais ao preencher formulários. Você pode tentar digitar "{{input}}" nas palavras de prompt.',
  autoAddVar:
    'Variáveis indefinidas referenciadas no pré-prompt, você deseja adicioná-las no formulário de entrada do usuário?',
  variableTable: {
    key: 'Chave da variável',
    name: 'Nome do campo de entrada do usuário',
    optional: 'Opcional',
    type: 'Tipo de entrada',
    action: 'Ações',
    typeString: 'Texto',
    typeSelect: 'Selecionar',
  },
  varKeyError: {
    canNoBeEmpty: 'A chave da variável não pode estar vazia',
    tooLong:
      'A chave da variável: {{key}} é muito longa. Não pode ter mais de 30 caracteres',
    notValid:
      'A chave da variável: {{key}} é inválida. Pode conter apenas letras, números e sublinhados',
    notStartWithNumber:
      'A chave da variável: {{key}} não pode começar com um número',
    keyAlreadyExists: 'A chave da variável: :{{key}} já existe',
  },
  otherError: {
    promptNoBeEmpty: 'O prompt não pode estar vazio',
    historyNoBeEmpty: 'O histórico de conversas deve ser definido no prompt',
    queryNoBeEmpty: 'A consulta deve ser definida no prompt',
  },
  variableConig: {
    modalTitle: 'Configurações do campo',
    description: 'Configuração para a variável {{varName}}',
    fieldType: 'Tipo de campo',
    string: 'Texto curto',
    paragraph: 'Parágrafo',
    select: 'Selecionar',
    notSet: 'Não definido, tente digitar {{input}} no prompt de prefixo',
    stringTitle: 'Opções da caixa de texto do formulário',
    maxLength: 'Comprimento máximo',
    options: 'Opções',
    addOption: 'Adicionar opção',
  },
  vision: {
    name: 'Visão',
    description:
      'Habilitar a Visão permitirá que o modelo receba imagens e responda perguntas sobre elas.',
    settings: 'Configurações',
    visionSettings: {
      title: 'Configurações de Visão',
      resolution: 'Resolução',
      resolutionTooltip: `resolução baixa permitirá que o modelo receba uma versão de baixa resolução de 512 x 512 da imagem e represente a imagem com um orçamento de 65 tokens. Isso permite que a API retorne respostas mais rápidas e consuma menos tokens de entrada para casos de uso que não exigem alta precisão.
            \n
            resolução alta permitirá que o modelo veja primeiro a imagem de baixa resolução e, em seguida, crie recortes detalhados das imagens de entrada como quadrados de 512px com base no tamanho da imagem de entrada. Cada um dos recortes detalhados usa o dobro do orçamento de tokens, totalizando 129 tokens.`,
      high: 'Alta',
      low: 'Baixa',
      uploadMethod: 'Método de upload',
      both: 'Ambos',
      localUpload: 'Upload local',
      url: 'URL',
      uploadLimit: 'Limite de upload',
    },
  },
  openingStatement: {
    title: 'Observações iniciais',
    add: 'Adicionar',
    writeOpner: 'Escrever observações',
    placeholder: 'Escreva sua mensagem de observações aqui',
    noDataPlaceHolder:
      'Iniciar a conversa com o usuário pode ajudar a IA a estabelecer uma conexão mais próxima com eles em aplicativos de conversação.',
    varTip: 'Você pode usar variáveis, tente digitar {{variável}}',
    tooShort:
      'São necessárias pelo menos 20 palavras de prompt inicial para gerar observações iniciais para a conversa.',
    notIncludeKey:
      'O prompt inicial não inclui a variável: {{key}}. Por favor, adicione-a ao prompt inicial.',
  },
  modelConfig: {
    model: 'Modelo',
    setTone: 'Definir tom das respostas',
    title: 'Modelo e Parâmetros',
    modeType: {
      chat: 'Chat',
      completion: 'Completar',
    },
  },
  inputs: {
    title: 'Depuração e Visualização',
    noPrompt: 'Tente escrever algum prompt na entrada de pré-prompt',
    userInputField: 'Campo de entrada do usuário',
    noVar:
      'Preencha o valor da variável, que será substituída automaticamente na palavra de prompt sempre que uma nova sessão for iniciada.',
    chatVarTip:
      'Preencha o valor da variável, que será substituída automaticamente na palavra de prompt sempre que uma nova sessão for iniciada',
    completionVarTip:
      'Preencha o valor da variável, que será substituída automaticamente nas palavras de prompt sempre que uma pergunta for enviada.',
    previewTitle: 'Visualização do prompt',
    queryTitle: 'Conteúdo da consulta',
    queryPlaceholder: 'Digite o texto da solicitação.',
    run: 'EXECUTAR',
  },
  result: 'Texto de saída',
  datasetConfig: {
    settingTitle: 'Configurações de recuperação',
    retrieveOneWay: {
      title: 'Recuperação N-para-1',
      description:
        'Com base na intenção do usuário e nas descrições do conhecimento, o Agente seleciona autonomamente o melhor Conhecimento para consulta. Melhor para aplicativos com Conhecimento distintos e limitados.',
    },
    retrieveMultiWay: {
      title: 'Recuperação de várias vias',
      description:
        'Com base na intenção do usuário, consulta todos os Conhecimentos, recupera texto relevante de várias fontes e seleciona os melhores resultados que correspondem à consulta do usuário após a reclassificação. É necessária a configuração da API do modelo de reclassificação.',
    },
    rerankModelRequired: 'O modelo de reclassificação é obrigatório',
    params: 'Parâmetros',
    top_k: 'Top K',
    top_kTip:
      'Usado para filtrar trechos mais semelhantes às perguntas do usuário. O sistema também ajustará dinamicamente o valor de Top K, de acordo com max_tokens do modelo selecionado.',
    score_threshold: 'Limiar de pontuação',
    score_thresholdTip:
      'Usado para definir o limiar de similaridade para filtragem de trechos.',
    retrieveChangeTip:
      'Modificar o modo de índice e o modo de recuperação pode afetar os aplicativos associados a este Conhecimento.',
  },
}

export default translation
