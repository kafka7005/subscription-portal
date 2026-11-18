// Внешние ссылки сайта. Переопределяются переменными окружения при сборке.
// Документы по умолчанию — свои страницы /docs/<slug>, текст редактируется в админке → Сайт.
const env = import.meta.env;

export const links = {
  offer: env.VITE_OFFER_URL || '/docs/offer',
  rules: env.VITE_RULES_URL || '/docs/rules',
  privacy: env.VITE_PRIVACY_URL || '/docs/privacy',
  support: env.VITE_SUPPORT_URL || '/cabinet/support',
  bot: env.VITE_BOT_URL || '/cabinet',
};
