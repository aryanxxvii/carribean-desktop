export const native = Boolean(window.carribean);

export async function call(action, payload) {
  if (native) {
    const result = await window.carribean.call(action, payload);
    if (result.error) throw new Error(result.error);
    return result.value;
  }
  const response = await fetch('./api/library', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Carribean': 'local' },
    body: JSON.stringify({ action, payload })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Caribbean could not reach the local library.');
  return result;
}

export const asset = (file) => /^https:\/\//i.test(file || '')
  ? file : file ? import.meta.env.BASE_URL + file : '';
