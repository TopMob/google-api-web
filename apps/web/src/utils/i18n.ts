export type Language = "ru" | "en";

export const translations = {
  ru: {
    // Brand & Workspace
    brandName: "GEMINI",
    brandSubtitle: "WEB2API",
    portalTitle: "Панель Разработчика",
    workspace: "Рабочее Пространство",

    // Tabs
    tabPlayground: "Чат / Тестирование",
    tabKeys: "API Ключи",
    tabLogs: "Логи в реальном времени",
    tabFaq: "Кука и Настройка",

    // Header & Stats
    modelLabel: "Модель:",
    modelLoading: "Загрузка моделей из Gemini...",
    customModelPlaceholder: "например, gemini-3.8-flash",
    btnList: "Список",
    btnCustom: "Вручную",
    btnCopyModel: "Скопировать модель",
    btnRefreshModels: "Запросить доступные модели у Google",
    copiedBadge: "Скопировано!",
    statRequests: "Запросов",
    statTokens: "Токенов",
    statSuccessRate: "Успешность",
    statSessionTime: "Время сессии",

    // Quick Copy Hub
    quickCopyTitle: "Быстрое подключение API",
    copyGateway: "Скопировать Gateway URL",
    copyKey: "Скопировать API Key",
    copyModel: "Скопировать имя модели",
    copyBundleEnv: "Скопировать .env",
    copyBundleCurl: "Скопировать cURL",
    gatewayCopied: "URL скопирован!",
    keyCopied: "Ключ скопирован!",
    modelCopied: "Модель скопирована!",
    bundleCopied: "Конфиг скопирован!",

    // Sidebar & Status
    connectionStatus: "Статус подключения",
    localGateway: "Локальный шлюз",
    statusOnline: "В СЕТИ",
    statusOffline: "НЕ В СЕТИ",
    statusChecking: "ПРОВЕРКА",
    activeBearerKey: "Активный API Ключ",
    noKeysOption: "Нет ключей (Создайте в API Keys)",
    defaultNoKey: "Без ключа (Прямой доступ)",

    // Playground
    playgroundWelcomeTitle: "Тестирование Gemini Шлюза",
    playgroundWelcomeSubtitle:
      "Отправляйте запросы напрямую в локальный Fastify-шлюз. Шлюз преобразует OpenAI-совместимые вызовы в нативные запросы к сессии Google Gemini Web.",
    userRole: "Пользователь",
    botRole: "Gemini Web2API",
    inputPlaceholder: "Введите сообщение для Gemini... (Enter для отправки)",
    btnSend: "Отправить",
    thinkingBadge: "Рассуждает...",
    activeEndpointChip: "Эндпоинт:",
    activeKeyChip: "Ключ:",
    activeModelChip: "Модель:",

    // Keys Tab
    keysTitle: "Управление API Ключами",
    keysSubtitle: "Создавайте и ограничивайте ключи для интеграции в сторонние клиенты (Cursor, VS Code, OpenCode).",
    createKeyTitle: "Создать новый ключ",
    keyNameLabel: "Название ключа",
    keyNamePlaceholder: "например, Cursor IDE, Telegram Bot",
    projectLabel: "Проект",
    expirationLabel: "Срок действия",
    expNever: "Бессрочно",
    exp1h: "1 час",
    exp24h: "24 часа",
    exp7d: "7 дней",
    exp30d: "30 дней",
    btnGenerateKey: "Сгенерировать ключ",
    existingKeysTitle: "Существующие ключи",
    thName: "Название",
    thKey: "Секретный ключ",
    thProject: "Проект",
    thCreated: "Создан",
    thExpires: "Истекает",
    thActions: "Действия",
    btnRevoke: "Отозвать",
    noKeysFound: "Пока не создано ни одного ключа.",

    // Projects
    projectsTitle: "Проекты",
    newProjectPlaceholder: "Название проекта...",
    btnAddProject: "Добавить",

    // Logs Tab
    logsTitle: "Логи обращений к API",
    logsSubtitle: "История входящих запросов к локальному шлюзу и ответы Google Gemini.",
    thTime: "Время",
    thMethod: "Метод",
    thPath: "Путь",
    thStatus: "Статус",
    thModel: "Модель",
    thLatency: "Задержка",
    noLogsYet: "Логи пока отсутствуют. Отправьте запрос из Playground или клиента.",

    // Language Toggle
    langRu: "РУС",
    langEn: "ENG"
  },

  en: {
    // Brand & Workspace
    brandName: "GEMINI",
    brandSubtitle: "WEB2API",
    portalTitle: "Developer Portal",
    workspace: "Workspace",

    // Tabs
    tabPlayground: "Playground Chat",
    tabKeys: "API Keys",
    tabLogs: "Real-time Logs",
    tabFaq: "Cookie & Setup",

    // Header & Stats
    modelLabel: "Model:",
    modelLoading: "Loading models from Gemini...",
    customModelPlaceholder: "e.g. gemini-3.8-flash",
    btnList: "List",
    btnCustom: "Custom",
    btnCopyModel: "Copy Model",
    btnRefreshModels: "Query available models from Google",
    copiedBadge: "Copied!",
    statRequests: "Requests",
    statTokens: "Tokens",
    statSuccessRate: "Success Rate",
    statSessionTime: "Session Time",

    // Quick Copy Hub
    quickCopyTitle: "Quick API Connect",
    copyGateway: "Copy Gateway URL",
    copyKey: "Copy API Key",
    copyModel: "Copy Model Name",
    copyBundleEnv: "Copy .env Bundle",
    copyBundleCurl: "Copy cURL",
    gatewayCopied: "URL Copied!",
    keyCopied: "Key Copied!",
    modelCopied: "Model Copied!",
    bundleCopied: "Config Copied!",

    // Sidebar & Status
    connectionStatus: "Connection Status",
    localGateway: "Local Gateway",
    statusOnline: "ONLINE",
    statusOffline: "OFFLINE",
    statusChecking: "CHECKING",
    activeBearerKey: "Active Bearer Key",
    noKeysOption: "No keys (Create in API Keys)",
    defaultNoKey: "No key (Direct access)",

    // Playground
    playgroundWelcomeTitle: "Gateway Playground",
    playgroundWelcomeSubtitle:
      "Submit raw completions directly to your local Fastify gateway. This playground interacts with the Google Web session using OpenAI schema compatibility.",
    userRole: "User Client",
    botRole: "Gemini Web2API",
    inputPlaceholder: "Type a prompt for Gemini... (Enter to send)",
    btnSend: "Send",
    thinkingBadge: "Thinking...",
    activeEndpointChip: "Endpoint:",
    activeKeyChip: "Key:",
    activeModelChip: "Model:",

    // Keys Tab
    keysTitle: "API Key Management",
    keysSubtitle: "Create and scope keys for third-party clients (Cursor, VS Code, OpenCode).",
    createKeyTitle: "Generate New Key",
    keyNameLabel: "Key Name",
    keyNamePlaceholder: "e.g. Cursor IDE, Telegram Bot",
    projectLabel: "Project",
    expirationLabel: "Expiration",
    expNever: "Never expires",
    exp1h: "1 hour",
    exp24h: "24 hours",
    exp7d: "7 days",
    exp30d: "30 days",
    btnGenerateKey: "Generate Key",
    existingKeysTitle: "Active API Keys",
    thName: "Name",
    thKey: "Secret Key",
    thProject: "Project",
    thCreated: "Created",
    thExpires: "Expires",
    thActions: "Actions",
    btnRevoke: "Revoke",
    noKeysFound: "No API keys created yet.",

    // Projects
    projectsTitle: "Projects",
    newProjectPlaceholder: "Project name...",
    btnAddProject: "Add",

    // Logs Tab
    logsTitle: "API Request Logs",
    logsSubtitle: "Live history of incoming client requests and Gemini responses.",
    thTime: "Time",
    thMethod: "Method",
    thPath: "Path",
    thStatus: "Status",
    thModel: "Model",
    thLatency: "Latency",
    noLogsYet: "No logs captured yet. Send a completion from Playground or client.",

    // Language Toggle
    langRu: "РУС",
    langEn: "ENG"
  }
} as const;

export type TranslationKeys = typeof translations.ru;
