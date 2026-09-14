// Texto do servidor em portugues e ingles: mensagens da API, notas gravadas nas execucoes e e-mail.
// O idioma de uma resposta HTTP vem do Accept-Language que o painel manda; o das notas e do e-mail vem
// de Ajustes (settings.language), porque ali ninguem esta logado. `pt` e o padrao: o CLI, a importacao e
// os testes antigos continuam lendo portugues. `en` e tipado contra `pt`: chave nova sem traducao nao compila.

export const LANGUAGES = ["pt", "en"] as const;
export type Language = (typeof LANGUAGES)[number];

// O middleware em app.ts preenche `req.language` a partir do Accept-Language antes de qualquer rota.
declare global {
  namespace Express {
    interface Request {
      language: Language;
    }
  }
}
export const DEFAULT_LANGUAGE: Language = "pt";
export const LOCALE: Record<Language, string> = { pt: "pt-BR", en: "en-US" };

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
}

/** Primeiro idioma aceito que o app fala; sem cabecalho, ou sem match, portugues. */
export function languageFromHeader(header: string | undefined): Language {
  if (!header) return DEFAULT_LANGUAGE;
  for (const part of header.split(",")) {
    const tag = part.split(";")[0].trim().toLowerCase();
    if (tag.startsWith("en")) return "en";
    if (tag.startsWith("pt")) return "pt";
  }
  return DEFAULT_LANGUAGE;
}

const pt = {
  // API
  invalidData: "Dados inválidos.",
  notFound: "Não encontrado.",
  routineNotFound: "Rotina não encontrada.",
  runNotFound: "Execução não encontrada.",
  routineHasActiveRun: "Esta rotina já tem uma execução na fila ou rodando.",
  deleteWithActiveRun: "Cancele a execução na fila ou rodando antes de excluir a rotina.",
  runAlreadyFinished: "Esta execução já terminou.",
  passwordAlreadySet: "A senha já foi criada. Entre com ela.",
  tooManyAttempts: "Muitas tentativas. Espere um minuto e tente de novo.",
  createPasswordFirst: "Crie a senha primeiro.",
  wrongPassword: "Senha incorreta.",
  currentPasswordWrong: "Senha atual incorreta.",
  notifyEmailMissing: "Cadastre e salve o e-mail de aviso antes de testar.",
  smtpNotConfigured: "SMTP não configurado neste PC: crie o arquivo .env a partir do .env.example e reinicie o app.",
  mailSendFailed: "Falha ao enviar o e-mail.",
  hostNotAllowed: "Host não permitido.",
  originNotAllowed: "Origem não permitida.",
  sessionExpired: "Sessão expirada. Entre de novo.",
  internalError: "Erro interno.",
  badRequest: "Requisição inválida.",
  routeNotFound: "Rota não encontrada.",
  // validacao
  nameRequired: "Dê um nome para a rotina.",
  directoryRequired: "Escolha o diretório.",
  daysRequired: "Escolha pelo menos um dia.",
  daysRepeated: "Dias repetidos.",
  timeInvalid: "Hora inválida: use HH:MM entre 00:00 e 23:59.",
  intervalInvalid: "Intervalo fora da lista.",
  commandTooLong: (max: number) => `O comando tem no máximo ${max} caracteres.`,
  commandRequired: "Escreva o comando.",
  commandOneLine: "O comando é uma linha só.",
  scriptHasNoModel: "Script não tem modelo.",
  onlyScriptHasCommand: "Só rotina de script tem comando.",
  promptRequired: "Escreva o prompt.",
  effortUnknown: "Esse effort não existe para o agente escolhido.",
  modelUnknown: "Esse modelo não existe para o agente escolhido.",
  binInvalid: "Caminho do binário com caractere não permitido.",
  notifyEmailInvalid: "E-mail de aviso inválido.",
  passwordTooShort: (min: number) => `A senha precisa de pelo menos ${min} caracteres.`,
  languageInvalid: "Idioma inválido.",
  // diretorio
  dirRootMissing: "Pasta mãe não configurada.",
  dirRootNotAbsolute: "Pasta mãe precisa ser um caminho absoluto.",
  dirNotAbsolute: "Diretório precisa ser um caminho absoluto.",
  dirRootNotFound: "Pasta mãe não existe.",
  dirNotFound: "Diretório não existe.",
  dirNotDirectory: "Diretório não é uma pasta.",
  dirUnsafeChars: "Diretório com caractere não permitido (% ou aspas).",
  dirSystem: "Diretório do sistema bloqueado.",
  dirOutsideRoot: "Diretório fora da pasta mãe.",
  // notas e erros gravados nas execucoes
  noteManual: "Execução manual.",
  noteSuperseded: "Substituída pela ocorrência mais recente.",
  noteRunOnBoot: (minutes: number) => `PC desligado no horário; executada ao ligar, com atraso de ${minutes} min.`,
  noteSkippedOff: "PC desligado ou app fechado no horário.",
  noteDisabled: "Rotina desativada.",
  noteCanceled: "Cancelada pelo usuário.",
  noteLimitSwitch: (agent: string, other: string) => `${agent} no limite de uso; rodando com ${other}.`,
  noteLimitWait: (agent: string, clock: string) => `${agent} no limite de uso; aguardando até ${clock}.`,
  noteLimitFallback: (agent: string, other: string) => `${agent} no limite de uso; nova tentativa com ${other}.`,
  noteRetry: (attempt: number, reason: string, clock: string) => `Tentativa ${attempt} falhou (${reason}); nova tentativa às ${clock}.`,
  reasonLimit: "limite de uso",
  reasonTransient: "erro temporário",
  reasonFatal: "erro",
  errorTimeout: (minutes: number) => `Timeout após ${minutes} min.`,
  errorSpawnAgent: (agent: string, detail: string) => `Falha ao iniciar ${agent}: ${detail}`,
  errorSpawnCommand: (detail: string) => `Falha ao iniciar o comando: ${detail}`,
  errorAgentExit: (agent: string, code: number | null) => `${agent} encerrou com código ${code}.`,
  errorCommandExit: (code: number | null) => `O comando encerrou com código ${code}.`,
  errorInterrupted: "Interrompida: o app foi encerrado durante a execução.",
  errorScriptWithoutCommand: "Rotina de script sem comando.",
  // e-mail
  mailNoTime: "sem horário",
  mailNoExitCode: "nenhum",
  mailNoDetail: "Sem detalhe registrado.",
  mailRoutine: "Rotina",
  mailKind: "Tipo",
  mailScheduledFor: "Horário previsto",
  mailFinishedAt: "Terminou em",
  mailAttempt: "Tentativa",
  mailExitCode: "Código de saída",
  mailFailedSubject: (name: string) => `[Syntax Routines] Falhou: ${name}`,
  mailFailedIntro: (name: string) => `A rotina "${name}" falhou.`,
  mailFailedIntroHtml: (nameHtml: string) => `A rotina <strong>${nameHtml}</strong> falhou.`,
  mailError: "Erro",
  mailPanel: "Painel",
  mailOpenPanel: "Abrir o painel",
  mailTestSubject: "[Syntax Routines] E-mail de teste",
  mailTestLine1: "Este é o e-mail de teste do Syntax Routines.",
  mailTestLine2: "Quando uma rotina falhar, o aviso chega neste endereço."
};

export type Messages = typeof pt;
export type MessageKey = keyof Messages;
/** Chaves cujo texto e fixo (sem parametro): as unicas que um erro pode carregar. */
export type TextKey = { [K in MessageKey]: Messages[K] extends string ? K : never }[MessageKey];

const en: Messages = {
  invalidData: "Invalid data.",
  notFound: "Not found.",
  routineNotFound: "Routine not found.",
  runNotFound: "Run not found.",
  routineHasActiveRun: "This routine already has a run queued or running.",
  deleteWithActiveRun: "Cancel the queued or running run before deleting the routine.",
  runAlreadyFinished: "This run has already finished.",
  passwordAlreadySet: "The password was already created. Sign in with it.",
  tooManyAttempts: "Too many attempts. Wait a minute and try again.",
  createPasswordFirst: "Create the password first.",
  wrongPassword: "Wrong password.",
  currentPasswordWrong: "Current password is wrong.",
  notifyEmailMissing: "Enter and save the alert e-mail before testing.",
  smtpNotConfigured: "SMTP is not configured on this PC: create the .env file from .env.example and restart the app.",
  mailSendFailed: "Failed to send the e-mail.",
  hostNotAllowed: "Host not allowed.",
  originNotAllowed: "Origin not allowed.",
  sessionExpired: "Session expired. Sign in again.",
  internalError: "Internal error.",
  badRequest: "Invalid request.",
  routeNotFound: "Route not found.",
  nameRequired: "Give the routine a name.",
  directoryRequired: "Choose the directory.",
  daysRequired: "Choose at least one day.",
  daysRepeated: "Repeated days.",
  timeInvalid: "Invalid time: use HH:MM between 00:00 and 23:59.",
  intervalInvalid: "Interval is not in the list.",
  commandTooLong: (max: number) => `The command has at most ${max} characters.`,
  commandRequired: "Write the command.",
  commandOneLine: "The command is a single line.",
  scriptHasNoModel: "A script has no model.",
  onlyScriptHasCommand: "Only a script routine has a command.",
  promptRequired: "Write the prompt.",
  effortUnknown: "That effort does not exist for the chosen agent.",
  modelUnknown: "That model does not exist for the chosen agent.",
  binInvalid: "Binary path with a character that is not allowed.",
  notifyEmailInvalid: "Invalid alert e-mail.",
  passwordTooShort: (min: number) => `The password needs at least ${min} characters.`,
  languageInvalid: "Invalid language.",
  dirRootMissing: "Root folder not configured.",
  dirRootNotAbsolute: "Root folder must be an absolute path.",
  dirNotAbsolute: "Directory must be an absolute path.",
  dirRootNotFound: "Root folder does not exist.",
  dirNotFound: "Directory does not exist.",
  dirNotDirectory: "Directory is not a folder.",
  dirUnsafeChars: "Directory with a character that is not allowed (% or quotes).",
  dirSystem: "System directory blocked.",
  dirOutsideRoot: "Directory outside the root folder.",
  noteManual: "Manual run.",
  noteSuperseded: "Replaced by the most recent occurrence.",
  noteRunOnBoot: (minutes: number) => `PC was off at the scheduled time; run at boot, after a ${minutes} min delay.`,
  noteSkippedOff: "PC off or app closed at the scheduled time.",
  noteDisabled: "Routine disabled.",
  noteCanceled: "Canceled by the user.",
  noteLimitSwitch: (agent: string, other: string) => `${agent} at its usage limit; running with ${other}.`,
  noteLimitWait: (agent: string, clock: string) => `${agent} at its usage limit; waiting until ${clock}.`,
  noteLimitFallback: (agent: string, other: string) => `${agent} at its usage limit; retrying with ${other}.`,
  noteRetry: (attempt: number, reason: string, clock: string) => `Attempt ${attempt} failed (${reason}); retrying at ${clock}.`,
  reasonLimit: "usage limit",
  reasonTransient: "temporary error",
  reasonFatal: "error",
  errorTimeout: (minutes: number) => `Timeout after ${minutes} min.`,
  errorSpawnAgent: (agent: string, detail: string) => `Failed to start ${agent}: ${detail}`,
  errorSpawnCommand: (detail: string) => `Failed to start the command: ${detail}`,
  errorAgentExit: (agent: string, code: number | null) => `${agent} exited with code ${code}.`,
  errorCommandExit: (code: number | null) => `The command exited with code ${code}.`,
  errorInterrupted: "Interrupted: the app was closed during the run.",
  errorScriptWithoutCommand: "Script routine without a command.",
  mailNoTime: "no time",
  mailNoExitCode: "none",
  mailNoDetail: "No detail recorded.",
  mailRoutine: "Routine",
  mailKind: "Kind",
  mailScheduledFor: "Scheduled for",
  mailFinishedAt: "Finished at",
  mailAttempt: "Attempt",
  mailExitCode: "Exit code",
  mailFailedSubject: (name: string) => `[Syntax Routines] Failed: ${name}`,
  mailFailedIntro: (name: string) => `The routine "${name}" failed.`,
  mailFailedIntroHtml: (nameHtml: string) => `The routine <strong>${nameHtml}</strong> failed.`,
  mailError: "Error",
  mailPanel: "Panel",
  mailOpenPanel: "Open the panel",
  mailTestSubject: "[Syntax Routines] Test e-mail",
  mailTestLine1: "This is the Syntax Routines test e-mail.",
  mailTestLine2: "When a routine fails, the alert arrives at this address."
};

const MESSAGES: Record<Language, Messages> = { pt, en };

export function messages(language: Language): Messages {
  return MESSAGES[language];
}

/** Erro que sabe se traduzir: `message` fica em portugues (CLI e logs), o handler HTTP responde no idioma do painel. */
export class LocalizedError extends Error {
  readonly key: TextKey;

  constructor(key: TextKey) {
    super(pt[key]);
    this.key = key;
  }

  localized(language: Language): string {
    return MESSAGES[language][this.key];
  }
}
