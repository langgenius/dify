const translation = {
  welcome: {
    firstStepTip: 'Per iniziare,',
    enterKeyTip: 'inserisci la tua OpenAI API Key qui sotto',
    getKeyTip: 'Ottieni la tua API Key dalla dashboard di OpenAI',
    placeholder: 'La tua OpenAI API Key(es. sk-xxxx)',
  },
  apiKeyInfo: {
    cloud: {
      trial: {
        title: 'Stai usando la quota di prova di {{providerName}}.',
        description:
          'La quota di prova è fornita per il tuo utilizzo di test. Prima che le chiamate della quota di prova siano esaurite, configura il tuo fornitore di modelli o acquista una quota aggiuntiva.',
      },
      exhausted: {
        title:
          'La tua quota di prova è stata utilizzata, configura la tua APIKey.',
        description:
          'La tua quota di prova è stata esaurita. Configura il tuo fornitore di modelli o acquista una quota aggiuntiva.',
      },
    },
    selfHost: {
      title: {
        row1: 'Per iniziare,',
        row2: 'configura prima il tuo fornitore di modelli.',
      },
    },
    callTimes: 'Numero di chiamate',
    usedToken: 'Token utilizzati',
    setAPIBtn: 'Vai a configurare il fornitore di modelli',
    tryCloud: 'O prova la versione cloud di Dify con quota gratuita',
  },
  overview: {
    title: 'Panoramica',
    appInfo: {
      explanation: 'AI WebApp pronta all\'uso',
      accessibleAddress: 'URL Pubblico',
      preview: 'Anteprima',
      regenerate: 'Rigenera',
      regenerateNotice: 'Vuoi rigenerare l\'URL pubblico?',
      preUseReminder: 'Attiva WebApp prima di continuare.',
      settings: {
        entry: 'Impostazioni',
        title: 'Impostazioni WebApp',
        webName: 'Nome WebApp',
        webDesc: 'Descrizione WebApp',
        webDescTip:
          'Questo testo verrà visualizzato sul lato client, fornendo una guida di base su come utilizzare l\'applicazione',
        webDescPlaceholder: 'Inserisci la descrizione della WebApp',
        language: 'Lingua',
        workflow: {
          title: 'Fasi del Workflow',
          show: 'Mostra',
          hide: 'Nascondi',
          subTitle: 'Dettagli del flusso di lavoro',
          showDesc: 'Mostrare o nascondere i dettagli del flusso di lavoro in WebApp',
        },
        chatColorTheme: 'Tema colore chat',
        chatColorThemeDesc: 'Imposta il tema colore del chatbot',
        chatColorThemeInverted: 'Inverso',
        invalidHexMessage: 'Valore esadecimale non valido',
        more: {
          entry: 'Mostra più impostazioni',
          copyright: 'Copyright',
          copyRightPlaceholder:
            'Inserisci il nome dell\'autore o dell\'organizzazione',
          privacyPolicy: 'Privacy Policy',
          privacyPolicyPlaceholder: 'Inserisci il link alla privacy policy',
          privacyPolicyTip:
            'Aiuta i visitatori a capire i dati raccolti dall\'applicazione, vedi la <privacyPolicyLink>Privacy Policy</privacyPolicyLink> di Dify.',
          customDisclaimer: 'Disclaimer Personalizzato',
          customDisclaimerPlaceholder:
            'Inserisci il testo del disclaimer personalizzato',
          customDisclaimerTip:
            'Il testo del disclaimer personalizzato verrà visualizzato sul lato client, fornendo informazioni aggiuntive sull\'applicazione',
        },
        sso: {
          label: 'Autenticazione SSO',
          title: 'WebApp SSO',
          description: 'Tutti gli utenti devono effettuare l\'accesso con SSO prima di utilizzare WebApp',
          tooltip: 'Contattare l\'amministratore per abilitare l\'SSO di WebApp',
        },
      },
      embedded: {
        entry: 'Incorporato',
        title: 'Incorpora sul sito web',
        explanation: 'Scegli come incorporare l\'app chat nel tuo sito web',
        iframe:
          'Per aggiungere l\'app chat ovunque sul tuo sito web, aggiungi questo iframe al tuo codice HTML.',
        scripts:
          'Per aggiungere un\'app chat in basso a destra del tuo sito web, aggiungi questo codice al tuo HTML.',
        chromePlugin: 'Installa l\'estensione Chrome di Dify Chatbot',
        copied: 'Copiato',
        copy: 'Copia',
      },
      qrcode: {
        title: 'Codice QR per condividere',
        scan: 'Scansiona Condividi Applicazione',
        download: 'Scarica Codice QR',
      },
      customize: {
        way: 'modo',
        entry: 'Personalizza',
        title: 'Personalizza AI WebApp',
        explanation:
          'Puoi personalizzare il frontend della Web App per adattarla alle tue esigenze di scenario e stile.',
        way1: {
          name: 'Fork il codice client, modificalo e distribuiscilo su Vercel (consigliato)',
          step1: 'Fork il codice client e modificalo',
          step1Tip:
            'Clicca qui per fork il codice sorgente nel tuo account GitHub e modifica il codice',
          step1Operation: 'Dify-WebClient',
          step2: 'Distribuisci su Vercel',
          step2Tip:
            'Clicca qui per importare il repository su Vercel e distribuisci',
          step2Operation: 'Importa repository',
          step3: 'Configura le variabili di ambiente',
          step3Tip: 'Aggiungi le seguenti variabili di ambiente su Vercel',
        },
        way2: {
          name: 'Scrivi codice lato client per chiamare l\'API e distribuiscilo su un server',
          operation: 'Documentazione',
        },
      },
    },
    apiInfo: {
      title: 'API del servizio backend',
      explanation: 'Facilmente integrabile nella tua applicazione',
      accessibleAddress: 'Endpoint del servizio API',
      doc: 'Riferimento API',
    },
    status: {
      running: 'In servizio',
      disable: 'Disabilita',
    },
  },
  analysis: {
    title: 'Analisi',
    ms: 'ms',
    tokenPS: 'Token/s',
    totalMessages: {
      title: 'Totale Messaggi',
      explanation: 'Conteggio delle interazioni giornaliere con l\'IA.',
    },
    totalConversations: {
      title: 'Conversazioni totali',
      explanation: 'Conteggio delle conversazioni giornaliere con l\'IA; ingegneria/debug dei prompt esclusi.',
    },
    activeUsers: {
      title: 'Utenti Attivi',
      explanation:
        'Utenti unici che interagiscono in Q&A con l\'AI; ingegneria dei prompt/debug esclusi.',
    },
    tokenUsage: {
      title: 'Uso dei Token',
      explanation:
        'Riflette l\'uso giornaliero dei token del modello linguistico per l\'applicazione, utile per il controllo dei costi.',
      consumed: 'Consumati',
    },
    avgSessionInteractions: {
      title: 'Interazioni Medie per Sessione',
      explanation:
        'Conteggio continuo delle comunicazioni utente-AI; per applicazioni basate su conversazione.',
    },
    avgUserInteractions: {
      title: 'Interazioni Medie per Utente',
      explanation:
        'Riflette la frequenza giornaliera di utilizzo degli utenti. Questo parametro riflette la fedeltà degli utenti.',
    },
    userSatisfactionRate: {
      title: 'Tasso di Soddisfazione degli Utenti',
      explanation:
        'Il numero di mi piace per 1.000 messaggi. Indica la proporzione di risposte con cui gli utenti sono molto soddisfatti.',
    },
    avgResponseTime: {
      title: 'Tempo Medio di Risposta',
      explanation:
        'Tempo (ms) per l\'AI per elaborare/rispondere; per applicazioni basate su testo.',
    },
    tps: {
      title: 'Velocità di Output dei Token',
      explanation:
        'Misura le prestazioni del LLM. Conta la velocità di output dei token del LLM dall\'inizio della richiesta al completamento dell\'output.',
    },
  },
}

export default translation
