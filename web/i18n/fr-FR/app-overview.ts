const translation = {
  welcome: {
    firstStepTip: 'Pour commencer,',
    enterKeyTip: 'entrez votre clé API OpenAI ci-dessous',
    getKeyTip: 'Obtenez votre clé API depuis le tableau de bord OpenAI',
    placeholder: 'Votre clé API OpenAI (par exemple, sk-xxxx)',
  },
  apiKeyInfo: {
    cloud: {
      trial: {
        title: 'Vous utilisez le quota d\'essai de {{providerName}}.',
        description: 'Le quota d\'essai est fourni pour votre utilisation de test. Avant que les appels de quota d\'essai ne soient épuisés, veuillez configurer votre propre fournisseur de modèle ou acheter un quota supplémentaire.',
      },
      exhausted: {
        title: 'Votre quota d\'essai a été utilisé, veuillez configurer votre APIKey.',
        description: 'Votre quota d\'essai a été épuisé. Veuillez configurer votre propre fournisseur de modèle ou acheter un quota supplémentaire.',
      },
    },
    selfHost: {
      title: {
        row1: 'Pour commencer,',
        row2: 'configurez d\'abord votre fournisseur de modèle.',
      },
    },
    callTimes: 'Heures d\'appel',
    usedToken: 'Token utilisé',
    setAPIBtn: 'Allez configurer le fournisseur de modèle',
    tryCloud: 'Ou essayez la version cloud de Dify avec un devis gratuit',
  },
  overview: {
    title: 'Aperçu',
    appInfo: {
      explanation: 'WebApp IA prête à l\'emploi',
      accessibleAddress: 'URL publique',
      preview: 'Aperçu',
      regenerate: 'Régénérer',
      preUseReminder: 'Veuillez activer WebApp avant de continuer.',
      settings: {
        entry: 'Paramètres',
        title: 'Paramètres de l\'application Web',
        webName: 'Nom de l\'application Web',
        webDesc: 'Description de l\'application web',
        webDescTip: 'Ce texte sera affiché du côté du client, fournissant des indications de base sur comment utiliser l\'application',
        webDescPlaceholder: 'Entrez la description de la WebApp',
        language: 'Langue',
        more: {
          entry: 'Montrer plus de paramètres',
          copyright: 'Droit d\'auteur',
          copyRightPlaceholder: 'Entrez le nom de l\'auteur ou de l\'organisation',
          privacyPolicy: 'Politique de Confidentialité',
          privacyPolicyPlaceholder: 'Entrez le lien de la politique de confidentialité',
          privacyPolicyTip: 'Aide les visiteurs à comprendre les données que l\'application collecte, voir la <privacyPolicyLink>Politique de Confidentialité</privacyPolicyLink> de Dify.',
        },
      },
      embedded: {
        entry: 'Intégré',
        title: 'Intégrer sur le site web',
        explanation: 'Choisissez la manière d\'intégrer l\'application de chat à votre site web',
        iframe: 'Pour ajouter l\'application de chat n\'importe où sur votre site web, ajoutez cette iframe à votre code html.',
        scripts: 'Pour ajouter une application de chat en bas à droite de votre site web, ajoutez ce code à votre html.',
        chromePlugin: 'Installez l\'extension Chrome Dify Chatbot',
        copied: 'Copié',
        copy: 'Copier',
      },
      qrcode: {
        title: 'QR code à partager',
        scan: 'Application de Partage de Scan',
        download: 'Télécharger le Code QR',
      },
      customize: {
        way: 'manière',
        entry: 'Personnaliser',
        title: 'Personnaliser l\'WebApp IA',
        explanation: 'Vous pouvez personnaliser l\'interface utilisateur de l\'application Web pour répondre à vos besoins en termes de scénario et de style.',
        way1: {
          name: 'Faites une fourchette du code client, modifiez-le et déployez-le sur Vercel (recommandé)',
          step1: 'Faites une fourchette du code client et modifiez-le',
          step1Tip: 'Cliquez ici pour bifurquer le code source dans votre compte GitHub et modifier le code',
          step1Operation: 'Dify-WebClient',
          step2: 'Déployer sur Vercel',
          step2Tip: 'Cliquez ici pour importer le dépôt dans Vercel et déployer',
          step2Operation: 'Importer le dépôt',
          step3: 'Configurer les variables d\'environnement',
          step3Tip: 'Ajoutez les variables d\'environnement suivantes dans Vercel',
        },
        way2: {
          name: 'Écrivez du code côté client pour appeler l\'API et déployez-le sur un serveur',
          operation: 'Documentation',
        },
      },
    },
    apiInfo: {
      title: 'API du service Backend',
      explanation: 'Facilement intégré dans votre application',
      accessibleAddress: 'Point de terminaison du service API',
      doc: 'Référence API',
    },
    status: {
      running: 'En service',
      disable: 'Désactiver',
    },
  },
  analysis: {
    title: 'Analyse',
    ms: 'ms',
    tokenPS: 'Jeton/s',
    totalMessages: {
      title: 'Messages Totaux',
      explanation: 'Nombre quotidien d\'interactions IA ; ingénierie/debuggage de prompt exclu.',
    },
    activeUsers: {
      title: 'Utilisateurs Actifs',
      explanation: 'Utilisateurs uniques participant à des Q&A avec l\'IA ; l\'ingénierie/débogage de prompt exclu.',
    },
    tokenUsage: {
      title: 'Utilisation de Token',
      explanation: 'Reflet de l\'utilisation quotidienne des jetons du modèle de langage pour l\'application, utile à des fins de contrôle des coûts.',
      consumed: 'Consommé',
    },
    avgSessionInteractions: {
      title: 'Interactions Moyennes par Session',
      explanation: 'Comptage continu de la communication utilisateur-IA ; pour les applications basées sur la conversation.',
    },
    userSatisfactionRate: {
      title: 'Taux de Satisfaction de l\'Utilisateur',
      explanation: 'Le nombre de "j\'aime" par 1 000 messages. Cela indique la proportion de réponses dont les utilisateurs sont très satisfaits.',
    },
    avgResponseTime: {
      title: 'Temps de réponse moyen',
      explanation: 'Temps (ms) pour que l\'IA traite/réponde; pour les applications basées sur le texte.',
    },
    tps: {
      title: 'Vitesse de Sortie des Tokens',
      explanation: 'Mesurez la performance du LLM. Comptez la vitesse de sortie des Tokens du LLM depuis le début de la demande jusqu\'à l\'achèvement de la sortie.',
    },
  },
}

export default translation
