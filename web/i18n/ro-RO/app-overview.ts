const translation = {
  welcome: {
    firstStepTip: 'Pentru a începe,',
    enterKeyTip: 'introduceți cheia API OpenAI mai jos',
    getKeyTip: 'Obțineți cheia API de la panoul de control OpenAI',
    placeholder: 'Cheia API OpenAI (de ex. sk-xxxx)',
  },
  apiKeyInfo: {
    cloud: {
      trial: {
        title: 'Utilizați cota de probă a furnizorului {{providerName}}.',
        description: 'Cota de probă este furnizată pentru utilizarea de testare. Înainte ca apelurile cotei de probă să se epuizeze, vă rugăm să configurați propriul furnizor de modele sau să achiziționați o cotă suplimentară.',
      },
      exhausted: {
        title: 'Cota de probă a fost epuizată, vă rugăm să configurați cheia API.',
        description: 'Cota de probă a fost epuizată. Vă rugăm să configurați propriul furnizor de modele sau să achiziționați o cotă suplimentară.',
      },
    },
    selfHost: {
      title: {
        row1: 'Pentru a începe,',
        row2: 'configurați mai întâi furnizorul de modele.',
      },
    },
    callTimes: 'Apeluri efectuate',
    usedToken: 'Token utilizat',
    setAPIBtn: 'Mergeți la configurarea furnizorului de modele',
    tryCloud: 'Sau încercați versiunea cloud a Dify cu cotă gratuită',
  },
  overview: {
    title: 'Prezentare generală',
    appInfo: {
      explanation: 'Aplicație web AI gata de utilizare',
      accessibleAddress: 'URL public',
      preview: 'Previzualizare',
      regenerate: 'Regenerare',
      regenerateNotice: 'Doriți să regenerați URL-ul public?',
      preUseReminder: 'Activați aplicația web înainte de a continua.',
      settings: {
        entry: 'Setări',
        title: 'Setări aplicație web',
        webName: 'Nume aplicație web',
        webDesc: 'Descriere aplicație web',
        webDescTip: 'Acest text va fi afișat pe partea clientului, oferind îndrumare de bază privind modul de utilizare a aplicației',
        webDescPlaceholder: 'Introduceți descrierea aplicației web',
        language: 'Limbă',
        workflow: {
          title: 'Pași flux de lucru',
          show: 'Afișați',
          hide: 'Ascundeți',
          subTitle: 'Detalii despre fluxul de lucru',
          showDesc: 'Afișarea sau ascunderea detaliilor fluxului de lucru în web app',
        },
        chatColorTheme: 'Tema de culoare a chatului',
        chatColorThemeDesc: 'Setați tema de culoare a chatbotului',
        chatColorThemeInverted: 'Inversat',
        invalidHexMessage: 'Valoare hex nevalidă',
        invalidPrivacyPolicy: 'Link politică de confidențialitate invalid. Vă rugăm să folosiți un link valid care începe cu http sau https',
        more: {
          entry: 'Afișați mai multe setări',
          copyright: 'Drepturi de autor',
          copyRightPlaceholder: 'Introduceți numele autorului sau al organizației',
          privacyPolicy: 'Politica de confidențialitate',
          privacyPolicyPlaceholder: 'Introduceți link-ul politicii de confidențialitate',
          privacyPolicyTip: 'Ajută vizitatorii să înțeleagă datele pe care le colectează aplicația, consultați <privacyPolicyLink>Politica de confidențialitate</privacyPolicyLink> a Dify.',
          customDisclaimerPlaceholder: 'Introduceți textul personalizat de declinare a responsabilității',
          customDisclaimerTip: 'Textul personalizat de declinare a responsabilității va fi afișat pe partea clientului, oferind informații suplimentare despre aplicație',
          customDisclaimer: 'Declinarea responsabilității personalizate',
          copyrightTip: 'Afișați informații despre drepturile de autor în aplicația web',
          copyrightTooltip: 'Vă rugăm să faceți upgrade la planul Professional sau la o versiune ulterioară',
        },
        sso: {
          label: 'Autentificare SSO',
          title: 'web app SSO',
          description: 'Toți utilizatorii trebuie să se conecteze cu SSO înainte de a utiliza web app',
          tooltip: 'Contactați administratorul pentru a activa web app SSO',
        },
        modalTip: 'Setările aplicației web pe partea clientului.',
      },
      embedded: {
        entry: 'Încorporat',
        title: 'Încorporați pe site-ul web',
        explanation: 'Alegeți modul de încorporare a aplicației de chat pe site-ul web',
        iframe: 'Pentru a adăuga aplicația de chat oriunde pe site-ul web, adăugați acest iframe la codul HTML.',
        scripts: 'Pentru a adăuga o aplicație de chat în colțul din dreapta jos al site-ului web, adăugați acest cod la codul HTML.',
        chromePlugin: 'Instalați extensia Chrome Dify Chatbot',
        copied: 'Copiat',
        copy: 'Copiați',
      },
      qrcode: {
        title: 'Cod QR pentru partajare',
        scan: 'Scanați pentru a partaja aplicația',
        download: 'Descărcați codul QR',
      },
      customize: {
        way: 'mod',
        entry: 'Personalizare',
        title: 'Personalizați aplicația web AI',
        explanation: 'Puteți personaliza interfața frontală a aplicației web pentru a se potrivi cu scenariul și stilul dorit.',
        way1: {
          name: 'Bifurcați codul clientului, modificați-l și implementați-l pe Vercel (recomandat)',
          step1: 'Bifurcați codul clientului și modificați-l',
          step1Tip: 'Faceți clic aici pentru a bifurca codul sursă în contul dvs. GitHub și a modifica codul',
          step1Operation: 'Dify-WebClient',
          step2: 'Implementați pe Vercel',
          step2Tip: 'Faceți clic aici pentru a importa depozitul în Vercel și a implementa',
          step2Operation: 'Importați depozitul',
          step3: 'Configurați variabilele de mediu',
          step3Tip: 'Adăugați următoarele variabile de mediu în Vercel',
        },
        way2: {
          name: 'Scrieți cod pe partea clientului pentru a apela API-ul și implementați-l pe un server',
          operation: 'Documentație',
        },
      },
      launch: 'Lansa',
    },
    apiInfo: {
      title: 'API serviciu backend',
      explanation: 'Ușor de integrat în aplicația dvs.',
      accessibleAddress: 'Punct final API serviciu',
      doc: 'Referință API',
    },
    status: {
      running: 'În service',
      disable: 'Dezactivat',
    },
  },
  analysis: {
    title: 'Analiză',
    ms: 'ms',
    tokenPS: 'Token/s',
    totalMessages: {
      title: 'Mesaje totale',
      explanation: 'Numărul de interacțiuni zilnice cu IA.',
    },
    totalConversations: {
      title: 'Total Conversații',
      explanation: 'Numărul de conversații zilnice cu IA; ingineria/depanarea prompturilor exclusă.',
    },
    activeUsers: {
      title: 'Utilizatori activi',
      explanation: 'Utilizatori unici care se angajează în întrebări și răspunsuri cu AI; exclud proiectarea și depanarea promptelor.',
    },
    tokenUsage: {
      title: 'Utilizare token',
      explanation: 'Reflectă utilizarea zilnică a tokenurilor de către modelul lingvistic pentru aplicație, utilă pentru controlul costurilor.',
      consumed: 'Consumat',
    },
    avgSessionInteractions: {
      title: 'Interacțiuni medii pe sesiune',
      explanation: 'Număr de comunicări continue utilizator-AI; pentru aplicații bazate pe conversație.',
    },
    avgUserInteractions: {
      title: 'Interacțiuni medii pe utilizator',
      explanation: 'Reflectă frecvența de utilizare zilnică a utilizatorilor. Această metrica reflectă cât de fideli sunt utilizatorii.',
    },
    userSatisfactionRate: {
      title: 'Rata de satisfacție a utilizatorilor',
      explanation: 'Numărul de aprecieri la 1.000 de mesaje. Acest lucru indică proporția de răspunsuri cu care utilizatorii sunt foarte mulțumiți.',
    },
    avgResponseTime: {
      title: 'Timp mediu de răspuns',
      explanation: 'Timp (ms) pentru procesarea/răspunsul AI; pentru aplicații bazate pe text.',
    },
    tps: {
      title: 'Viteza de ieșire a tokenurilor',
      explanation: 'Măsoară performanța modelului de limbaj mare. Numără viteza de ieșire a tokenurilor din modelul de limbaj mare de la începutul cererii până la finalizarea ieșirii.',
    },
  },
}

export default translation
