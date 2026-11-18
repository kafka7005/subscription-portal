// Тонкая обёртка над API бота (SoloBot API v2).
// Сессия хранится в HttpOnly-cookie `auth_token`, поэтому все запросы идут
// на тот же домен (/api проксируется на бота) с credentials: 'include'.

export class ApiError extends Error {
  constructor(status, message, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

function detailMessage(data, status) {
  const detail = data?.detail ?? data?.message ?? data?.error;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail) && detail[0]?.msg) return detail.map((d) => d.msg).join('; ');
  if (status === 401) return 'Нужно войти в аккаунт';
  if (status === 403) return 'Недостаточно прав';
  if (status === 404) return 'Не найдено';
  if (status === 429) return 'Слишком много запросов, попробуйте чуть позже';
  if (status >= 500) return 'Сервер временно недоступен';
  return `Ошибка ${status}`;
}

function buildUrl(path, query) {
  const url = new URL(path.startsWith('/api') ? path : `/api${path}`, window.location.origin);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
    }
  }
  return url.pathname + url.search;
}

let unauthorizedHandler = null;
export function onUnauthorized(handler) { unauthorizedHandler = handler; }

export async function request(method, path, { query, body, signal, raw } = {}) {
  const init = { method, credentials: 'include', signal, headers: { Accept: 'application/json' } };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetch(buildUrl(path, query), init);
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiError(0, 'Нет соединения с сервером');
  }
  if (raw) return response;
  const text = await response.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  if (!response.ok) {
    if (response.status === 401 && unauthorizedHandler) unauthorizedHandler();
    throw new ApiError(response.status, detailMessage(data, response.status), data);
  }
  return data;
}

export const api = {
  get: (path, query, opts) => request('GET', path, { ...opts, query }),
  post: (path, body, opts) => request('POST', path, { ...opts, body }),
  put: (path, body, opts) => request('PUT', path, { ...opts, body }),
  patch: (path, body, opts) => request('PATCH', path, { ...opts, body }),
  del: (path, opts) => request('DELETE', path, opts),
};
