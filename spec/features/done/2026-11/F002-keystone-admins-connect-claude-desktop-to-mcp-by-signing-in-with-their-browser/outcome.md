# Outcome

A Keystone admin adds `/mcp` as a custom connector in Claude Desktop, signs in with their Keystone email and password on a page that the package serves, and Claude then acts as that admin under Keystone access control. The owner confirmed it works in Claude Desktop on 2026-11-07, through a scratch app behind a cloudflared tunnel. Package merge: `04897c1` with the review fixes in `6aa0bb6`.

The Admin UI sign-in cannot carry the OAuth step, so the package has its own sign-in and consent page. OAuth state is in memory: a restart signs everyone out, and a grant ends with the Keystone session (8 hours by default). Behind a tunnel or TLS proxy the app must set Express `trust proxy`. Every `POST /mcp` needs a token; anonymous use of `/mcp` ended with this feature. Accepted review notes: the in-memory stores can be evicted by an attacker with many IPs, and reuse of a code or refresh token does not revoke the tokens issued from it.
