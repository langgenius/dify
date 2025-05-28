# CONTRIBUINDO

Então você está procurando contribuir para o Dify - isso é incrível, mal podemos esperar para ver o que você vai fazer. Como uma startup com equipe e financiamento limitados, temos grandes ambições de projetar o fluxo de trabalho mais intuitivo para construir e gerenciar aplicações LLM. Qualquer ajuda da comunidade conta, verdadeiramente.

Precisamos ser ágeis e entregar rapidamente considerando onde estamos, mas também queremos garantir que colaboradores como você tenham uma experiência o mais tranquila possível ao contribuir. Montamos este guia de contribuição com esse propósito, visando familiarizá-lo com a base de código e como trabalhamos com os colaboradores, para que você possa rapidamente passar para a parte divertida.

Este guia, como o próprio Dify, é um trabalho em constante evolução. Agradecemos muito a sua compreensão se às vezes ele ficar atrasado em relação ao projeto real, e damos as boas-vindas a qualquer feedback para que possamos melhorar.

Em termos de licenciamento, por favor, dedique um minuto para ler nosso breve [Acordo de Licença e Contribuidor](./LICENSE). A comunidade também adere ao [código de conduta](https://github.com/langgenius/.github/blob/main/CODE_OF_CONDUCT.md).

## Antes de começar

Procurando algo para resolver? Navegue por nossos [problemas para iniciantes](https://github.com/langgenius/dify/issues?q=is%3Aissue%20state%3Aopen%20label%3A%22good%20first%20issue%22) e escolha um para começar!

Tem um novo modelo ou ferramenta para adicionar? Abra um PR em nosso [repositório de plugins](https://github.com/langgenius/dify-plugins) e mostre-nos o que você construiu.

Precisa atualizar um modelo existente, ferramenta ou corrigir alguns bugs? Vá para nosso [repositório oficial de plugins](https://github.com/langgenius/dify-official-plugins) e faça sua mágica!

Junte-se à diversão, contribua e vamos construir algo incrível juntos! 💡✨

Não se esqueça de vincular um problema existente ou abrir um novo problema na descrição do PR.

### Relatórios de bugs

> [!IMPORTANT]
> Por favor, certifique-se de incluir as seguintes informações ao enviar um relatório de bug:

- Um título claro e descritivo
- Uma descrição detalhada do bug, incluindo quaisquer mensagens de erro
- Passos para reproduzir o bug
- Comportamento esperado
- **Logs**, se disponíveis, para problemas de backend, isso é realmente importante, você pode encontrá-los nos logs do docker-compose
- Capturas de tela ou vídeos, se aplicável

Como priorizamos:

  | Tipo de Problema                                              | Prioridade      |
  | ------------------------------------------------------------ | --------------- |
  | Bugs em funções centrais (serviço em nuvem, não conseguir fazer login, aplicações não funcionando, falhas de segurança) | Crítica         |
  | Bugs não críticos, melhorias de desempenho                   | Prioridade Média |
  | Correções menores (erros de digitação, interface confusa mas funcional) | Prioridade Baixa |

### Solicitações de recursos

> [!NOTE]
> Por favor, certifique-se de incluir as seguintes informações ao enviar uma solicitação de recurso:

- Um título claro e descritivo
- Uma descrição detalhada do recurso
- Um caso de uso para o recurso
- Qualquer outro contexto ou capturas de tela sobre a solicitação de recurso

Como priorizamos:

  | Tipo de Recurso                                              | Prioridade      |
  | ------------------------------------------------------------ | --------------- |
  | Recursos de alta prioridade conforme rotulado por um membro da equipe | Prioridade Alta |
  | Solicitações populares de recursos do nosso [quadro de feedback da comunidade](https://github.com/langgenius/dify/discussions/categories/feedbacks) | Prioridade Média |
  | Recursos não essenciais e melhorias menores                  | Prioridade Baixa |
  | Valiosos mas não imediatos                                  | Recurso Futuro  |
## Enviando seu PR

### Processo de Pull Request

1. Faça um fork do repositório
2. Antes de elaborar um PR, por favor crie um problema para discutir as mudanças que você quer fazer
3. Crie um novo branch para suas alterações
4. Por favor, adicione testes para suas alterações conforme apropriado
5. Certifique-se de que seu código passa nos testes existentes
6. Por favor, vincule o problema na descrição do PR, `fixes #<número_do_problema>`
7. Faça o merge do seu código!
### Configurando o projeto

#### Frontend

Para configurar o serviço frontend, por favor consulte nosso [guia abrangente](https://github.com/langgenius/dify/blob/main/web/README.md) no arquivo `web/README.md`. Este documento fornece instruções detalhadas para ajudá-lo a configurar o ambiente frontend adequadamente.

#### Backend

Para configurar o serviço backend, por favor consulte nossas [instruções detalhadas](https://github.com/langgenius/dify/blob/main/api/README.md) no arquivo `api/README.md`. Este documento contém um guia passo a passo para ajudá-lo a colocar o backend em funcionamento sem problemas.

#### Outras coisas a observar

Recomendamos revisar este documento cuidadosamente antes de prosseguir com a configuração, pois ele contém informações essenciais sobre:
- Pré-requisitos e dependências
- Etapas de instalação
- Detalhes de configuração
- Dicas comuns de solução de problemas

Sinta-se à vontade para entrar em contato se encontrar quaisquer problemas durante o processo de configuração.
## Obtendo Ajuda

Se você ficar preso ou tiver uma dúvida urgente enquanto contribui, simplesmente envie suas perguntas através do problema relacionado no GitHub, ou entre no nosso [Discord](https://discord.gg/8Tpq4AcN9c) para uma conversa rápida. 
