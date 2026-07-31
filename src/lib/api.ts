export async function apiFetch(base: string, path: string, opts: RequestInit & { body?: any; token?: string } = {}) {
  const url = `${base}${path.startsWith('/') ? path : '/' + path}`;
  const headers: Record<string, string> = {
    'Accept': 'application/json'
  };
  let body: any = opts.body;

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (opts.token) {
    headers.Authorization = `token ${opts.token}`;
  }

  const res = await fetch(url, {
    ...opts,
    headers: { ...(opts.headers as any), ...headers },
    body: body !== undefined ? JSON.stringify(body) : opts.body
  });

  const text = await res.text();
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  if (!res.ok) {
    const msg = payload?.error || (typeof payload === 'string' ? payload : `HTTP ${res.status}`);
    throw new Error(msg);
  }
  return payload;
}
