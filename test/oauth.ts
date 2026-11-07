import { createHash, randomBytes } from 'node:crypto';
import { ADMIN } from './schema.js';

export const CLAUDE_REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

/** A PKCE verifier and its S256 challenge. */
export function pkce() {
  const verifier = randomBytes(32).toString('base64url');

  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

/** Registers a public client with DCR and returns its `client_id`. */
export async function register(base: string, redirectUris = [CLAUDE_REDIRECT], path = '/mcp'): Promise<string> {
  const response = await fetch(`${base}${path}/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'Claude', redirect_uris: redirectUris, token_endpoint_auth_method: 'none' }),
  });

  if (response.status !== 201) throw new Error(`register: ${response.status} ${await response.text()}`);

  return ((await response.json()) as { client_id: string }).client_id;
}

/** Opens the authorize URL as a browser would and returns the response. */
export function authorize(base: string, params: Record<string, string>, path = '/mcp'): Promise<Response> {
  return fetch(`${base}${path}/oauth/authorize?${new URLSearchParams(params)}`, { redirect: 'manual' });
}

/** Reads the hidden transaction field of the sign-in page. */
export function transactionOf(html: string): string {
  const match = /name="transaction" value="([^"]+)"/.exec(html);

  if (!match) throw new Error(`no transaction field in: ${html}`);

  return match[1]!;
}

/** Submits the sign-in form as a browser would and returns the response. */
export function submitSignIn(base: string, fields: Record<string, string>, path = '/mcp'): Promise<Response> {
  return fetch(`${base}${path}/oauth/signin`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
    redirect: 'manual',
  });
}

/** Posts a form to the token endpoint and returns the status and the JSON body. */
export async function token(base: string, fields: Record<string, string>, path = '/mcp') {
  const response = await fetch(`${base}${path}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  });

  return { status: response.status, body: (await response.json()) as Record<string, string> };
}

/**
 * Runs the whole flow: DCR, authorize, sign-in, and the code exchange. The default user is the fixture's admin.
 * Returns the token response and the `client_id`.
 */
export async function signIn(base: string, path = '/mcp', user = ADMIN) {
  const clientId = await register(base, [CLAUDE_REDIRECT], path);
  const { verifier, challenge } = pkce();

  const page = await authorize(
    base,
    { client_id: clientId, redirect_uri: CLAUDE_REDIRECT, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state: 's1' },
    path,
  );

  const transaction = transactionOf(await page.text());
  const signedIn = await submitSignIn(base, { transaction, identity: user.email, secret: user.password, decision: 'allow' }, path);
  const code = new URL(signedIn.headers.get('location')!).searchParams.get('code')!;

  const { body } = await token(
    base,
    { grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier, redirect_uri: CLAUDE_REDIRECT },
    path,
  );

  return { clientId, accessToken: body.access_token!, refreshToken: body.refresh_token! };
}
