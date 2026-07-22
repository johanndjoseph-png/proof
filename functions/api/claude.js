/**
 * Proof — server-side proxy to the Anthropic API.
 *
 * Lives at:  functions/api/claude.js
 * Serves:    POST /api/claude
 *
 * Because this sits inside the Pages project, it is behind the same hostname
 * as the site — so the Cloudflare Access policy protecting proof.pages.dev
 * protects this endpoint too. Nobody reaches it without signing in first.
 *
 * The API key is stored as an encrypted environment variable named
 * ANTHROPIC_API_KEY. It is never sent to the browser.
 */

const MAX_BODY = 40 * 1024 * 1024;   // generous — PDFs and video frames are large
const ALLOWED_MODELS = [
  'claude-sonnet-5',
  'claude-opus-4-8',
  'claude-haiku-4-5-20251001'
];

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json({ error: 'POST only.' }, 405);

  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: 'Server is missing ANTHROPIC_API_KEY.' }, 500);
  }

  let body;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY) return json({ error: 'Request too large.' }, 413);
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'Could not read the request.' }, 400);
  }

  // only let through the models we expect, so a tampered client
  // cannot point our key at something unexpected
  if (!ALLOWED_MODELS.includes(body.model)) {
    body.model = ALLOWED_MODELS[0];
  }
  body.max_tokens = Math.min(body.max_tokens || 8000, 16000);

  // who asked — Cloudflare Access adds this once the user has signed in
  const who = request.headers.get('cf-access-authenticated-user-email') || 'unknown';
  console.log(`[proof] ${who} -> ${body.model}`);

  let upstream;
  try {
    upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });
  } catch (err) {
    return json({ error: 'Could not reach Claude: ' + err.message }, 502);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
