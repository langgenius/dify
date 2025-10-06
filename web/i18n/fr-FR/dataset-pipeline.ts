const translation = {
  creation: {
    createFromScratch: {
      title: 'Pipeline de connaissances vide',
      description: 'Créez un pipeline personnalisé à partir de zéro avec un contrôle total sur le traitement et la structure des données.',
    },
    caution: 'Prudence',
    createKnowledge: 'Créer des connaissances',
    successTip: 'Création réussie d’une base de connaissances',
    backToKnowledge: 'Retour à la page Connaissances',
    importDSL: 'Importation à partir d’un fichier DSL',
    errorTip: 'Échec de la création d’une base de connaissances',
  },
  templates: {
    customized: 'Personnalisé',
  },
  operations: {
    preview: 'Aperçu',
    process: 'Processus',
    convert: 'Convertir',
    exportPipeline: 'Pipeline d’exportation',
    choose: 'Choisir',
    details: 'Détails',
    saveAndProcess: 'Enregistrer et traiter',
    editInfo: 'Modifier les infos',
    useTemplate: 'Utiliser ce pipeline de connaissances',
    dataSource: 'Source des données',
    backToDataSource: 'Retour à la source de données',
  },
  deletePipeline: {
    title: 'Êtes-vous sûr de supprimer ce modèle de pipeline ?',
    content: 'La suppression du modèle de pipeline est irréversible.',
  },
  publishPipeline: {
    success: {
      message: 'Pipeline de connaissances publié',
    },
    error: {
      message: 'Échec de la publication du pipeline de connaissances',
    },
  },
  publishTemplate: {
    success: {
      learnMore: 'Pour en savoir plus',
      tip: 'Vous pouvez utiliser ce modèle sur la page de création.',
      message: 'Modèle de pipeline publié',
    },
    error: {
      message: 'Échec de la publication du modèle de pipeline',
    },
  },
  exportDSL: {
    errorTip: 'Echec de l’exportation du DSL du pipeline',
    successTip: 'Pipeline d’exportation DSL réussi',
  },
  details: {
    structure: 'Structure',
    structureTooltip: 'La structure par blocs détermine la façon dont les documents sont divisés et indexés (en proposant les modes Général, Parent-Enfant et Q&R) et est unique à chaque base de connaissances.',
  },
  testRun: {
    steps: {
      dataSource: 'Source des données',
      documentProcessing: 'Traitement des documents',
    },
    dataSource: {
      localFiles: 'Fichiers locaux',
    },
    notion: {
      title: 'Choisissez les pages Notion',
      docTitle: 'Docs Notion',
    },
    title: 'Série d’essai',
    tooltip: 'En mode de test, un seul document peut être importé à la fois pour faciliter le débogage et l’observation.',
  },
  inputFieldPanel: {
    uniqueInputs: {
      title: 'Entrées uniques pour chaque entrée',
      tooltip: 'Les entrées uniques ne sont accessibles qu’à la source de données sélectionnée et à ses nœuds en aval. Les utilisateurs n’auront pas besoin de le remplir lorsqu’ils choisiront d’autres sources de données. Seuls les champs de saisie référencés par les variables de source de données apparaîtront dans la première étape (Source de données). Tous les autres champs seront affichés à la deuxième étape (Traiter les documents).',
    },
    globalInputs: {
      title: 'Entrées globales pour toutes les entrées',
      tooltip: 'Les entrées globales sont partagées entre tous les nœuds. Les utilisateurs devront les remplir lors de la sélection d’une source de données. Par exemple, des champs tels que le délimiteur et la longueur maximale des morceaux peuvent être appliqués uniformément à plusieurs sources de données. Seuls les champs de saisie référencés par les variables de source de données apparaissent dans la première étape (Source de données). Tous les autres champs s’affichent à la deuxième étape (Traiter les documents).',
    },
    preview: {
      stepTwoTitle: 'Documents de processus',
      stepOneTitle: 'Source des données',
    },
    error: {
      variableDuplicate: 'Le nom de la variable existe déjà. Veuillez choisir un autre nom.',
    },
    editInputField: 'Modifier le champ de saisie',
    title: 'Champs de saisie utilisateur',
    addInputField: 'Ajouter un champ de saisie',
    description: 'Les champs de saisie utilisateur sont utilisés pour définir et collecter les variables requises pendant le processus d’exécution du pipeline. Les utilisateurs peuvent personnaliser le type de champ et configurer de manière flexible la valeur d’entrée pour répondre aux besoins des différentes sources de données ou étapes de traitement des documents.',
  },
  addDocuments: {
    steps: {
      processDocuments: 'Documents de processus',
      processingDocuments: 'Traitement des documents',
      chooseDatasource: 'Choisissez une source de données',
    },
    stepOne: {
      preview: 'Aperçu',
    },
    stepTwo: {
      previewChunks: 'Prévisualiser les morceaux',
      chunkSettings: 'Paramètres de bloc',
    },
    stepThree: {
      learnMore: 'Pour en savoir plus',
    },
    characters: 'caractères',
    title: 'Ajouter des documents',
    backToDataSource: 'Source des données',
  },
  documentSettings: {
    title: 'Paramètres du document',
  },
  onlineDocument: {},
  onlineDrive: {
    breadcrumbs: {
      searchPlaceholder: 'Rechercher des fichiers...',
      allBuckets: 'Tous les compartiments de stockage dans le cloud',
      allFiles: 'Tous les fichiers',
    },
    notSupportedFileType: 'Ce type de fichier n’est pas pris en charge',
    emptySearchResult: 'Aucun objet n’a été trouvé',
    emptyFolder: 'Ce dossier est vide',
    resetKeywords: 'Réinitialiser les mots-clés',
  },
  credentialSelector: {},
  conversion: {
    confirm: {
      title: 'Confirmation',
      content: 'Cette action est permanente. Vous ne pourrez pas revenir à la méthode précédente. Veuillez confirmer la conversion.',
    },
    title: 'Convertir vers le pipeline de connaissances',
    warning: 'Cette action ne peut pas être annulée.',
    successMessage: 'Conversion réussie du jeu de données en pipeline',
    errorMessage: 'Échec de la conversion du jeu de données en pipeline',
    descriptionChunk2: '— une approche plus ouverte et plus flexible avec un accès aux plugins de notre Marketplace. Cela appliquera la nouvelle méthode de traitement à tous les documents futurs.',
    descriptionChunk1: 'Vous pouvez désormais convertir votre base de connaissances existante pour utiliser le pipeline de connaissances pour le traitement des documents',
  },
  knowledgePermissions: 'Autorisations',
  editPipelineInfo: 'Modifier les informations sur le pipeline',
  knowledgeNameAndIconPlaceholder: 'Entrez le nom de la base de connaissances',
  pipelineNameAndIcon: 'Nom et icône du pipeline',
  knowledgeDescription: 'Description des connaissances',
  knowledgeNameAndIcon: 'Nom et icône de la connaissance',
  inputField: 'Champ de saisie',
  knowledgeDescriptionPlaceholder: 'Décrivez le contenu de cette base de connaissances. Une description détaillée permet à l’IA d’accéder plus précisément au contenu de l’ensemble de données. S’il est vide, Dify utilisera la stratégie d’accès par défaut. (Facultatif)',
}

export default translation
