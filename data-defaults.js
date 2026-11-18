/**
 * Vitally Flow — Dados Iniciais e Catálogo Oficial
 * Inclui as 9 verticais, os 47 cases oficiais da Benner Jurídico,
 * 2 contas de exemplo pré-carregadas e templates editáveis.
 */

export const VERTICALS = [
  'Saúde',
  'Serviços de Facilities',
  'Transportes e Mobilidade',
  'Indústria',
  'Varejo',
  'Serviços Financeiros',
  'Educação',
  'Saneamento',
  'Público',
];

// Catálogo oficial: 47 clientes Benner Jurídico divididos nas 9 verticais
export const BENNER_CASES = {
  Saúde: [
    "Rede D'Or São Luiz",
    'Hospital Sírio-Libanês',
    'Unimed Seguros',
    'Hapvida NotreDame Intermédica',
    'Dasa',
    'Grupo Fleury',
    'Sabin Medicina Diagnóstica',
  ], // 7
  'Serviços de Facilities': [
    'Sodexo Brasil',
    'Grupo GPS',
    'Verzani & Sandrini',
    'Manserv',
    'ISS Facility Services',
  ], // 5
  'Transportes e Mobilidade': [
    'Localiza&Co',
    'Rumo Logística',
    'Movida',
    'Azul Linhas Aéreas',
    'Grupo CCR',
    'JSL Logística',
  ], // 6
  Indústria: [
    'Gerdau',
    'Suzano',
    'Embraer',
    'WEG',
    'Klabin',
    'Votorantim Cimentos',
    'Usiminas',
  ], // 7
  Varejo: [
    'Magazine Luiza',
    'Lojas Renner',
    'Carrefour Brasil',
    'Raia Drogasil',
    'Grupo Boticário',
    'Assaí Atacadista',
  ], // 6
  'Serviços Financeiros': [
    'Banco Safra',
    'Porto Seguro',
    'XP Inc.',
    'Cielo',
    'SulAmérica',
  ], // 5
  Educação: [
    'Cogna Educação',
    'Yduqs',
    'Ânima Educação',
    'Ser Educacional',
  ], // 4
  Saneamento: [
    'Sabesp',
    'Aegea Saneamento',
    'Iguá Saneamento',
  ], // 3
  Público: [
    'Correios',
    'Petrobras',
    'Banco do Brasil',
    'Caixa Econômica Federal',
  ], // 4
};
// Total: 7 + 5 + 6 + 7 + 6 + 5 + 4 + 3 + 4 = 47 cases oficiais

export const DEFAULT_TEMPLATES = {
  email1Subject: '{empresa} | Leitura automática de petições e previsibilidade de provisão',
  email1Body: `Olá {nome},

Tentei falar com você há pouco por telefone sobre a rotina jurídica da {empresa} em {vertical}.

Em operações que atendemos no setor, como {case_1} e {case_2}, o maior ganho recente veio de agentes de IA que leem petições iniciais sozinhos, fazem o pré-cadastro dos processos e calculam provisões com base no histórico de decisões semelhantes.

Isso reduz drasticamente o trabalho manual de triagem e traz mais segurança para a controladoria nos fechamentos.

Se fizer sentido conhecer em 15 minutos práticos, qual o melhor dia e horário para conversarmos esta semana?

Ou, se esse tema não estiver no radar da {empresa} neste trimestre, basta responder "agora não" que encerro meus contatos por aqui.

Abraço,
{assinatura}`,

  email2Subject: 'Re: {empresa} | Referência em {vertical} ({case_1})',
  email2Body: `Olá {nome}, tudo bem?

Retomo o contato de forma breve. Conversando com lideranças de {vertical} como {case_1} e {case_2}, percebemos que o principal ponto de atenção não é ter mais um relatório, mas eliminar o gargalo entre o recebimento da citação e a consistência da provisão contábil.

Preparamos um recorte objetivo de 15 minutos mostrando como a leitura autônoma de iniciais tem operado na prática.

Faz sentido agendarmos uma conversa rápida esta semana, ou este assunto está fora de prioridade no momento?

Atenciosamente,
{assinatura}`,

  email3Subject: 'Encerrando meu acompanhamento — {empresa}',
  email3Body: `Olá {nome},

Como não consegui retorno nas últimas tentativas, imagino que o tema de automação na leitura de petições e cálculo de provisão não seja prioridade para a {empresa} neste momento.

Para não ocupar sua caixa de entrada, estou encerrando meu ciclo de contatos por aqui.

Caso queira retomar em outro momento (ou se houver outra pessoa responsável por essa frente em {vertical}), basta me responder com um "sim" ou "falar depois".

Sucesso nas entregas da equipe!

{assinatura}`,

  whatsappPontual: `Olá {nome}, tudo bem? Aqui é o Fábio Medeiros da Benner Jurídico. Tentei falar com você por telefone agora há pouco. Atendemos grupos de {vertical} como {case_1} e {case_2} com agentes de Inteligência Artificial que leem petições iniciais sozinhos e calibram provisões pelo histórico de decisões. Faz sentido uma conversa rápida de 15 minutos?

{assinatura}`,
};

export const DEFAULT_PROJECT_CONFIG = {
  dailyTarget: 25,
  newTarget: 7,
  followupTarget: 18,
  maxAttempts: 3,
  bitrixTitleTemplate: '[Prospecção Telefone + E-mail · [Decisor]] | [Empresa]',
  bitrixActivityTemplate: `[Prospecção Telefone + E-mail · [Decisor]] | [Empresa]
Próximo Passo: [ProximoPasso]
Sistema Atual: [SistemaAtual]
Histórico: [Historico]`,
  signature: 'Fábio Medeiros\nBenner Jurídico',
};

export const DEFAULT_KNOWLEDGE_DOC_MD = `# Benner Jurídico — Base Oficial de Inteligência Comercial

## Proposta de Valor Principal
- **Agentes de Inteligência Artificial autônomos**: leem petições iniciais de ponta a ponta sozinhos, executam o pré-cadastro completo dos processos e calculam provisões com base no histórico de decisões semelhantes.
- **Para Persona Jurídica**: elimina digitação manual na triagem de citações, reduz risco de perda de prazos e libera o time para estratégia contenciosa.
- **Para Persona Financeira / Controladoria**: entrega previsibilidade de caixa, lastro auditável para fechamentos contábeis e redução de desvios em provisões.

## Regras Rígidas de Comunicação
- Escrever sempre sem abreviações (nunca usar "min", "att", "vc", "pq", "obs").
- Assinatura oficial: **Fábio Medeiros — Benner Jurídico**.
- Horários sugeridos para reuniões matinais com o closer Marcelo Medeiros: **09h30**, **10h00** ou **10h30**.
- Cadência padrão: **3 tentativas** antes do E-mail de Blackout e descarte automático.

## Catálogo Oficial — 47 Cases por Vertical
${Object.entries(BENNER_CASES)
  .map(([vertical, list]) => `- **${vertical}**: ${list.join(', ')}`)
  .join('\n')}
`;

export const DEFAULT_ACCOUNTS = [
  {
    id: 'acc-sirio-libanes',
    empresa: 'Hospital Sírio-Libanês',
    vertical: 'Saúde',
    funcionariosEstimados: 8000,
    funcionariosTexto: '~8.000',
    processosTexto: '~220 / mês',
    icpStatus: 'validado',
    resumo:
      'Referência hospitalar de alta complexidade com grande volume de ações cíveis, regulatórias e trabalhistas mensais. Demanda central por agilidade na triagem de petições iniciais e precisão de provisões contábeis.',
    decisor: 'Dra. Mariana Vasconcelos',
    cargo: 'Diretora Jurídica',
    persona: 'Jurídico',
    email: 'mariana.vasconcelos@hsl.org.br',
    telefone: '(11) 3394-0200',
    sistemaAtual: '',
    personasIdentificadas: [
      { nome: 'Dra. Mariana Vasconcelos', cargo: 'Diretora Jurídica', perfil: 'Jurídico' },
      { nome: 'Diretoria de Controladoria', cargo: 'Controller Hospitalar', perfil: 'Financeiro' },
    ],
    contexto:
      'Alto volume de ações cíveis e trabalhistas mensais; diretoria busca reduzir triagem manual de iniciais e padronizar cálculo de provisão para auditoria.',
    dorEspecifica: 'triagem manual de petições iniciais e padronização de provisão para auditoria',
    ganchoPersonalizado: 'crescimento da operação hospitalar e necessidade de previsibilidade contenciosa mensal',
    cases: ["Rede D'Or São Luiz", 'Dasa', 'Grupo Fleury'],
    tentativa: 1,
    leadQuente: false,
    status: 'ativo',
    lastNote: 'Dossiê estruturado com cases de Saúde.',
    proximoPasso: '',
    historico: [
      '17/11 - 09h15 | Dossiê inicial estruturado com cases de Saúde.',
    ],
  },
  {
    id: 'acc-localiza-co',
    empresa: 'Localiza&Co',
    vertical: 'Transportes e Mobilidade',
    funcionariosEstimados: 20000,
    funcionariosTexto: '~20.000',
    processosTexto: '~1.400 / mês',
    icpStatus: 'validado',
    resumo:
      'Líder nacional em mobilidade e gestão de frotas com contencioso de alto volume distribuído em todo o país. Foco estratégico em previsibilidade de passivo e governança financeira.',
    decisor: 'Ricardo Albuquerque',
    cargo: 'Head de Controladoria Jurídica',
    persona: 'Financeiro',
    email: 'ricardo.albuquerque@localiza.com',
    telefone: '(31) 3247-7000',
    sistemaAtual: '',
    personasIdentificadas: [
      { nome: 'Ricardo Albuquerque', cargo: 'Head de Controladoria Jurídica', perfil: 'Financeiro' },
      { nome: 'Gerência Contenciosa', cargo: 'Gestor Jurídico Nacional', perfil: 'Jurídico' },
    ],
    contexto:
      'Operação nacional pulverizada com forte demanda por previsibilidade de passivo e conciliação contábil mensal. Abriu E-mail 1 duas vezes.',
    dorEspecifica: 'previsibilidade de passivo e conciliação contábil mensal em operação nacional pulverizada',
    ganchoPersonalizado: 'abertura recorrente do primeiro contato e necessidade de lastro auditável no fechamento',
    cases: ['Rumo Logística', 'Movida', 'Grupo CCR'],
    tentativa: 2,
    leadQuente: true,
    status: 'ativo',
    lastNote: 'Tentativa 1 em caixa postal. Abriu E-mail 1 às 10h42.',
    proximoPasso: 'D+2 úteis às 14h30 (turno oposto: tarde)',
    historico: [
      '15/11 - 09h40 | Telefone (Tentativa 1/3) — Não atendeu, enviado E-mail 1.',
    ],
  },
];

export const DEFAULT_PLAYBOOK_RULES = `Atue como Especialista Sênior em Inteligência Comercial B2B da Benner Jurídico.

1. Pesquisa & Cruzamento com a Base de Conhecimento:
- Ao analisar uma nova empresa, identifique seu porte, modelo operacional, estrutura jurídica/controladoria e volume provável de contencioso.
- Cruze obrigatoriamente os achados da pesquisa web e do card do Bitrix24 com os documentos da Base de Conhecimento Markdown do projeto.

2. Dores Prioritárias a Destacar no Dossiê:
- Para Jurídico: gargalos de triagem manual de petições iniciais, pré-cadastro de processos, risco de prazos e sobrecarga operacional.
- Para Financeiro / Controladoria: previsibilidade de caixa, cálculo de provisão auditável com base no histórico de decisões semelhantes e conciliação contábil.

3. Cases & Provas Sociais:
- Selecione de 2 a 3 cases reais exclusivamente da mesma vertical da empresa analisada.

4. Regras Rígidas de Linguagem:
- Escreva sempre em português executivo claro, direto e sem abreviações (nunca usar "min", "att", "vc", "pq", "obs", "Dr.", "Dra.").`;
