const translation = {
  title: 'Configurações do conhecimento',
  desc: 'Aqui você pode modificar as propriedades e métodos de trabalho do conhecimento.',
  form: {
    name: 'Nome do conhecimento',
    namePlaceholder: 'Por favor, insira o nome do conhecimento',
    nameError: 'O nome não pode estar vazio',
    desc: 'Descrição do conhecimento',
    descInfo: 'Por favor, escreva uma descrição textual clara para delinear o conteúdo do conhecimento. Esta descrição será usada como base para a correspondência ao selecionar entre vários conhecimentos para inferência.',
    descPlaceholder: 'Descreva o que está neste conhecimento. Uma descrição detalhada permite que a IA acesse o conteúdo do conhecimento de forma oportuna. Se estiver vazio, o Dify usará a estratégia de correspondência padrão.',
    descWrite: 'Aprenda como escrever uma boa descrição do conhecimento.',
    permissions: 'Permissões',
    permissionsOnlyMe: 'Apenas eu',
    permissionsAllMember: 'Todos os membros da equipe',
    indexMethod: 'Método de indexação',
    indexMethodHighQuality: 'Alta qualidade',
    indexMethodHighQualityTip: 'Chame a interface de incorporação da OpenAI para processamento, fornecendo maior precisão quando os usuários consultam.',
    indexMethodEconomy: 'Econômico',
    indexMethodEconomyTip: 'Use motores de vetor offline, índices de palavras-chave, etc. para reduzir a precisão sem gastar tokens.',
    embeddingModel: 'Modelo de incorporação',
    embeddingModelTip: 'Altere o modelo incorporado, por favor, vá para ',
    embeddingModelTipLink: 'Configurações',
    retrievalSetting: {
      title: 'Configuração de recuperação',
      learnMore: 'Saiba mais',
      description: ' sobre o método de recuperação.',
      longDescription: ' sobre o método de recuperação, você pode alterar isso a qualquer momento nas configurações do conhecimento.',
    },
    save: 'Salvar',
  },
}

export default translation
