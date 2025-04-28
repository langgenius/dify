const translation = {
  common: {
    welcome: '',
    appUnavailable: 'O aplicativo não está disponível',
    appUnknownError: 'O aplicativo encontrou um erro desconhecido',
  },
  chat: {
    newChat: 'Nova conversa',
    pinnedTitle: 'Fixado',
    unpinnedTitle: 'Conversas',
    newChatDefaultName: 'Nova conversa',
    resetChat: 'Redefinir conversa',
    poweredBy: 'Desenvolvido por',
    prompt: 'Prompt',
    privatePromptConfigTitle: 'Configurações da conversa',
    publicPromptConfigTitle: 'Prompt inicial',
    configStatusDes: 'Antes de começar, você pode modificar as configurações da conversa',
    configDisabled:
      'As configurações da sessão anterior foram usadas para esta sessão.',
    startChat: 'Iniciar conversa',
    privacyPolicyLeft:
      'Por favor, leia a ',
    privacyPolicyMiddle:
      'política de privacidade',
    privacyPolicyRight:
      ' fornecida pelo desenvolvedor do aplicativo.',
    deleteConversation: {
      title: 'Excluir conversa',
      content: 'Tem certeza de que deseja excluir esta conversa?',
    },
    tryToSolve: 'Tente resolver',
    temporarySystemIssue: 'Desculpe, problema temporário do sistema.',
    expand: 'Expandir',
    collapse: 'Contrair',
  },
  generation: {
    tabs: {
      create: 'Executar uma vez',
      batch: 'Executar em lote',
      saved: 'Salvo',
    },
    savedNoData: {
      title: 'Você ainda não salvou um resultado!',
      description: 'Comece a gerar conteúdo e encontre seus resultados salvos aqui.',
      startCreateContent: 'Começar a criar conteúdo',
    },
    title: 'Completar com IA',
    queryTitle: 'Consultar conteúdo',
    completionResult: 'Resultado da conclusão',
    queryPlaceholder: 'Escreva sua consulta...',
    run: 'Executar',
    copy: 'Copiar',
    resultTitle: 'Completar com IA',
    noData: 'A IA fornecerá o que você deseja aqui.',
    csvUploadTitle: 'Arraste e solte seu arquivo CSV aqui ou ',
    browse: 'navegue',
    csvStructureTitle: 'O arquivo CSV deve seguir a seguinte estrutura:',
    downloadTemplate: 'Baixe o modelo aqui',
    field: 'Campo',
    batchFailed: {
      info: '{{num}} execuções falharam',
      retry: 'Tentar novamente',
      outputPlaceholder: 'Nenhum conteúdo de saída',
    },
    errorMsg: {
      empty: 'Por favor, insira conteúdo no arquivo enviado.',
      fileStructNotMatch: 'O arquivo CSV enviado não corresponde à estrutura.',
      emptyLine: 'A linha {{rowIndex}} está vazia',
      invalidLine: 'Linha {{rowIndex}}: o valor de {{varName}} não pode estar vazio',
      moreThanMaxLengthLine: 'Linha {{rowIndex}}: o valor de {{varName}} não pode ter mais de {{maxLength}} caracteres',
      atLeastOne: 'Por favor, insira pelo menos uma linha no arquivo enviado.',
    },
  },
}

export default translation
