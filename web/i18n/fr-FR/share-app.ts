const translation = {
  common: {
    welcome: '',
    appUnavailable: 'L\'application n\'est pas disponible',
    appUnkonwError: 'L\'application n\'est pas disponible',
  },
  chat: {
    newChat: 'Nouveau chat',
    pinnedTitle: 'Épinglé',
    unpinnedTitle: 'Discussions',
    newChatDefaultName: 'Nouvelle conversation',
    resetChat: 'Réinitialiser la conversation',
    powerBy: 'Propulsé par',
    prompt: 'Prompt',
    privatePromptConfigTitle: 'Paramètres de conversation',
    publicPromptConfigTitle: 'Prompt Initial',
    configStatusDes: 'Avant de commencer, vous pouvez modifier les paramètres de conversation',
    configDisabled:
      'Les paramètres de la session précédente ont été utilisés pour cette session.',
    startChat: 'Commencer le Chat',
    privacyPolicyLeft:
      'Veuillez lire',
    privacyPolicyMiddle:
      'politique de confidentialité',
    privacyPolicyRight:
      'fourni par le développeur de l\'application.',
    deleteConversation: {
      title: 'Supprimer la conversation',
      content: 'Êtes-vous sûr de vouloir supprimer cette conversation ?',
    },
    tryToSolve: 'Essayez de résoudre',
    temporarySystemIssue: 'Désolé, problème temporaire du système.',
  },
  generation: {
    tabs: {
      create: 'Exécuter une fois',
      batch: 'Exécuter le lot',
      saved: 'Enregistré',
    },
    savedNoData: {
      title: 'Vous n\'avez pas encore enregistré de résultat !',
      description: 'Commencez à générer du contenu et retrouvez vos résultats sauvegardés ici.',
      startCreateContent: 'Commencez à créer du contenu',
    },
    title: 'Complétion IA',
    queryTitle: 'Contenu de la requête',
    completionResult: 'Résultat de la complétion',
    queryPlaceholder: 'Rédigez le contenu de votre requête...',
    run: 'Exécuter',
    copy: 'Copier',
    resultTitle: 'Complétion IA',
    noData: 'L\'IA vous donnera ce que vous voulez ici.',
    csvUploadTitle: 'Faites glisser et déposez votre fichier CSV ici, ou',
    browse: 'parcourir',
    csvStructureTitle: 'Le fichier CSV doit se conformer à la structure suivante :',
    downloadTemplate: 'Téléchargez le modèle ici',
    field: 'Champ',
    batchFailed: {
      info: '{{num}} exécutions échouées',
      retry: 'Réessayer',
      outputPlaceholder: 'Aucun contenu de sortie',
    },
    errorMsg: {
      empty: 'Veuillez entrer le contenu dans le fichier téléchargé.',
      fileStructNotMatch: 'Le fichier CSV téléchargé ne correspond pas à la structure.',
      emptyLine: 'La ligne {{rowIndex}} est vide',
      invalidLine: 'Row {{rowIndex}}: {{varName}} value can not be empty',
      moreThanMaxLengthLine: 'Row {{rowIndex}}: {{varName}} value can not be more than {{maxLength}} characters',
      atLeastOne: 'Veuillez entrer au moins une ligne dans le fichier téléchargé.',
    },
  },
}

export default translation
