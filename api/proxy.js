// Proxy de reserva (Edge Function da Vercel) para mídia que não esteja em
// jd-s3.cdn.ubi.com nem no nohud. Mantém Range (para o vídeo poder pular)
// e devolve com CORS liberado, para o WebGL conseguir usar como textura.
export const config = { runtime: 'edge' };

// Só repassa para estes domínios (evita virar proxy aberto).
const ALLOWED = ['jd-s3.cdn.ubi.com', 'jdleaderboards.com', 'ubi.com'];

export default async function handler(req) {
  const raw = new URL(req.url).searchParams.get('url');
  let target;
  try { target = new URL(raw); } catch { return new Response('url inválida', { status: 400 }); }
  const host = target.hostname;
  if (target.protocol !== 'https:' || !ALLOWED.some(h => host === h || host.endsWith('.' + h)))
    return new Response('domínio não permitido', { status: 403 });

  const headers = {};
  const range = req.headers.get('range');
  if (range) headers.range = range;
  const upstream = await fetch(target.toString(), { headers });

  const out = new Headers();
  for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'])
    if (upstream.headers.get(k)) out.set(k, upstream.headers.get(k));
  out.set('access-control-allow-origin', '*');
  out.set('cache-control', 'public, max-age=86400');
  return new Response(upstream.body, { status: upstream.status, headers: out });
}
