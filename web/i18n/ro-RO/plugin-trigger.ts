const translation = {
  subscription: {
    title: 'Abonamente',
    listNum: 'Abonamente {{num}}',
    empty: {
      title: 'Fără abonamente',
      button: 'Abonament nou',
    },
    createButton: {
      oauth: 'Abonament nou cu OAuth',
      apiKey: 'Abonament nou cu cheia API',
      manual: 'Lipiți URL-ul pentru a crea un abonament nou',
    },
    createSuccess: 'Abonament creat cu succes',
    createFailed: 'Eșec la crearea abonamentului',
    maxCount: 'Max {{num}} abonamente',
    selectPlaceholder: 'Selectați abonamentul',
    noSubscriptionSelected: 'Nicio abonare selectată',
    subscriptionRemoved: 'Abonament eliminat',
    list: {
      title: 'Abonamente',
      addButton: 'Adaugă',
      tip: 'Primește evenimente prin abonament',
      item: {
        enabled: 'Activat',
        disabled: 'Dezactivat',
        credentialType: {
          api_key: 'Cheie API',
          oauth2: 'OAuth',
          unauthorized: 'Manual',
        },
        actions: {
          delete: 'Șterge',
          deleteConfirm: {
            title: 'Ștergi {{name}}?',
            success: 'Abonamentul {{name}} a fost șters cu succes',
            error: 'Nu s-a putut șterge abonamentul {{name}}',
            content: 'Odată șters, acest abonament nu poate fi recuperat. Vă rugăm să confirmați.',
            contentWithApps: 'Abonamentul curent este referențiat de {{count}} aplicații. Ștergerea acestuia va determina aplicațiile configurate să înceteze să mai primească evenimentele abonamentului.',
            confirm: 'Confirmă ștergerea',
            cancel: 'Anulează',
            confirmInputWarning: 'Vă rugăm să introduceți numele corect pentru confirmare.',
            confirmInputPlaceholder: 'Introduceți "{{name}}" pentru a confirma.',
            confirmInputTip: 'Vă rugăm să introduceți „{{name}}” pentru a confirma.',
          },
        },
        status: {
          active: 'Activ',
          inactive: 'Inactiv',
        },
        usedByNum: 'Folosit de {{num}} fluxuri de lucru',
        noUsed: 'Niciun flux de lucru utilizat',
      },
    },
    addType: {
      title: 'Adaugă abonament',
      description: 'Alege cum dorești să creezi abonamentul pentru declanșator',
      options: {
        apikey: {
          title: 'Creează cu cheia API',
          description: 'Creează automat abonamente folosind acreditările API',
        },
        oauth: {
          title: 'Creează cu OAuth',
          description: 'Autentifică-te cu o platformă terță pentru a crea un abonament',
          clientSettings: 'Setări client OAuth',
          clientTitle: 'Client OAuth',
          default: 'Implicit',
          custom: 'Personalizat',
        },
        manual: {
          title: 'Configurare manuală',
          description: 'Lipiți URL-ul pentru a crea un abonament nou',
          tip: 'Configurează URL-ul pe platforma terță manual',
        },
      },
    },
  },
  modal: {
    steps: {
      verify: 'Verifică',
      configuration: 'Configurație',
    },
    common: {
      cancel: 'Anulează',
      back: 'Înapoi',
      next: 'Următor',
      create: 'Creează',
      verify: 'Verifică',
      authorize: 'Autorizează',
      creating: 'Se creează...',
      verifying: 'Se verifică...',
      authorizing: 'Se autorizează...',
    },
    oauthRedirectInfo: 'Deoarece nu au fost găsite secrete ale clienților de sistem pentru acest furnizor de instrumente, este necesară configurarea manuală, pentru redirect_uri, vă rugăm să folosiți',
    apiKey: {
      title: 'Creează cu cheia API',
      verify: {
        title: 'Verifică acreditările',
        description: 'Vă rugăm să furnizați acreditările API pentru a verifica accesul',
        error: 'Verificarea acreditărilor a eșuat. Vă rugăm să verificați cheia API.',
        success: 'Datele de autentificare au fost verificate cu succes',
      },
      configuration: {
        title: 'Configurează abonamentul',
        description: 'Configurează parametrii abonamentului tău',
      },
    },
    oauth: {
      title: 'Creează cu OAuth',
      authorization: {
        title: 'Autorizare OAuth',
        description: 'Permiteți lui Dify să acceseze contul dumneavoastră',
        redirectUrl: 'Redirecționează URL-ul',
        redirectUrlHelp: 'Folosește acest URL în configurația aplicației tale OAuth',
        authorizeButton: 'Autentifică-te cu {{provider}}',
        waitingAuth: 'Așteptare autorizare...',
        authSuccess: 'Autorizare reușită',
        authFailed: 'Eșuat la obținerea informațiilor de autorizare OAuth',
        waitingJump: 'Autorizat, în așteptarea săriturii',
      },
      configuration: {
        title: 'Configurează abonamentul',
        description: 'Configurează parametrii abonamentului după autorizare',
        success: 'Configurarea OAuth a fost realizată cu succes',
        failed: 'Configurarea OAuth a eșuat',
      },
      remove: {
        success: 'Eliminarea OAuth a fost realizată cu succes',
        failed: 'Eliminarea OAuth a eșuat',
      },
      save: {
        success: 'Configurarea OAuth a fost salvată cu succes',
      },
    },
    manual: {
      title: 'Configurare manuală',
      description: 'Configurează-ți abonamentul webhook manual',
      logs: {
        title: 'Jurnale de cereri',
        request: 'Cerere',
        loading: 'Așteptând cererea de la {{pluginName}}...',
      },
    },
    form: {
      subscriptionName: {
        label: 'Numele abonamentului',
        placeholder: 'Introduceți numele abonamentului',
        required: 'Numele abonamentului este obligatoriu',
      },
      callbackUrl: {
        label: 'URL de returnare',
        description: 'Acest URL va primi evenimente webhook',
        tooltip: 'Oferiți un punct de acces public care să poată primi cereri de apel invers de la furnizorul de declanșare.',
        placeholder: 'Generare...',
        privateAddressWarning: 'Această adresă URL pare să fie una internă, ceea ce poate cauza eșecul solicitărilor webhook. Puteți schimba TRIGGER_URL cu o adresă publică.',
      },
    },
    errors: {
      createFailed: 'Eșec la crearea abonamentului',
      verifyFailed: 'Nu s-au putut verifica acreditările',
      authFailed: 'Autorizare eșuată',
      networkError: 'Eroare de rețea, vă rugăm să încercați din nou',
    },
  },
  events: {
    title: 'Evenimente disponibile',
    description: 'Evenimente la care acest plugin de declanșare se poate abona',
    empty: 'Nu sunt evenimente disponibile',
    event: 'Eveniment',
    events: 'Evenimente',
    actionNum: '{{num}} {{event}} INCLUS',
    item: {
      parameters: 'parametrii {{count}}',
      noParameters: 'Fără parametri',
    },
    output: 'Ieșire',
  },
  node: {
    status: {
      warning: 'Deconectare',
    },
  },
}

export default translation
