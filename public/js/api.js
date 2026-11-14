export async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data;
  try { data = await res.json(); } catch { data = { ok: false, error: '服务器返回了非 JSON 内容（' + res.status + '）' }; }
  if (!res.ok || data.ok === false) throw new Error(data.error || '请求失败（' + res.status + '）');
  return data;
}
export const get = (u) => api('GET', u);
export const post = (u, b = {}) => api('POST', u, b);
export const put = (u, b = {}) => api('PUT', u, b);
export const del = (u) => api('DELETE', u);
export const patch = (u, b = {}) => api('PATCH', u, b);
