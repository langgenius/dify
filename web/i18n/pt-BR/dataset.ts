const translation = {
  knowledge: 'Wiedza',
  documentCount: ' documentos',
  wordCount: 'k palavras',
  appCount: ' aplicativos vinculados',
  createDataset: 'Criar Conhecimento',
  createDatasetIntro: 'Importe seus próprios dados de texto ou escreva dados em tempo real via Webhook para aprimoramento de contexto LLM.',
  deleteDatasetConfirmTitle: 'Excluir este Conhecimento?',
  deleteDatasetConfirmContent:
    'A exclusão do Conhecimento é irreversível. Os usuários não poderão mais acessar seu Conhecimento e todas as configurações e registros de prompt serão excluídos permanentemente.',
  datasetDeleted: 'Conhecimento excluído',
  datasetDeleteFailed: 'Falha ao excluir o Conhecimento',
  didYouKnow: 'Você sabia?',
  intro1: 'O Conhecimento pode ser integrado ao aplicativo Dify ',
  intro2: 'como um contexto',
  intro3: ',',
  intro4: 'ou pode ser criado',
  intro5: ' como um plug-in de índice ChatGPT independente para publicação',
  unavailable: 'Indisponível',
  unavailableTip: 'O modelo de incorporação não está disponível, o modelo de incorporação padrão precisa ser configurado',
  datasets: 'CONHECIMENTO',
  datasetsApi: 'API',
  retrieval: {
    semantic_search: {
      title: 'Pesquisa Vetorial',
      description: 'Gere incorporações de consulta e pesquise o trecho de texto mais semelhante à sua representação vetorial.',
    },
    full_text_search: {
      title: 'Pesquisa de Texto Completo',
      description: 'Indexe todos os termos no documento, permitindo que os usuários pesquisem qualquer termo e recuperem trechos de texto relevantes contendo esses termos.',
    },
    hybrid_search: {
      title: 'Pesquisa Híbrida',
      description: 'Execute pesquisas de texto completo e pesquisas vetoriais simultaneamente, reclassifique para selecionar a melhor correspondência para a consulta do usuário. A configuração da API do modelo de reclassificação é necessária.',
      recommend: 'Recomendar',
    },
    invertedIndex: {
      title: 'Índice Invertido',
      description: 'O Índice Invertido é uma estrutura usada para recuperação eficiente. Organizado por termos, cada termo aponta para documentos ou páginas da web que o contêm.',
    },
    change: 'Alterar',
    changeRetrievalMethod: 'Alterar método de recuperação',
  },
}

export default translation
