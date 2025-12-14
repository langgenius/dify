const translation = {
  title: 'Teste de Recuperação',
  desc: 'Teste o efeito de recuperação do conhecimento com base no texto de consulta fornecido.',
  dateTimeFormat: 'MM/DD/YYYY hh:mm A',
  table: {
    header: {
      source: 'Origem',
      time: 'Hora',
      queryContent: 'Conteúdo da Consulta',
    },
  },
  input: {
    title: 'Texto de origem',
    placeholder: 'Digite um texto, uma frase declarativa curta é recomendada.',
    countWarning: 'Até 200 caracteres.',
    indexWarning: 'Somente conhecimento de alta qualidade.',
    testing: 'Testando',
  },
  hit: {
    title: 'PARÁGRAFOS DE RECUPERAÇÃO',
    emptyTip: 'Os resultados do teste de recuperação serão exibidos aqui',
  },
  noRecentTip: 'Nenhum resultado de consulta recente aqui',
  viewChart: 'Ver GRÁFICO DE VETORES',
  viewDetail: 'Ver detalhes',
  settingTitle: 'Configuração de recuperação',
  records: 'Arquivo',
  hitChunks: 'Hit {{num}} pedaços filhos',
  open: 'Abrir',
  chunkDetail: 'Detalhe do pedaço',
  keyword: 'Palavras-chave',
  imageUploader: {
    tip: 'Carregar ou soltar imagens (Máx. {{batchCount}}, {{size}}MB cada)',
    tooltip: 'Carregar imagens (Máx. {{batchCount}}, {{size}}MB cada)',
    dropZoneTip: 'Arraste o arquivo aqui para enviar',
    singleChunkAttachmentLimitTooltip: 'O número de anexos de um único bloco não pode exceder {{limit}}',
  },
}

export default translation
