# OpenID Connect single sign-on

FUXA can delegate the login to an OpenID Connect identity provider (IdP): Keycloak, Microsoft
Entra ID, Okta, Auth0, Authentik, Google, ... The user signs in at the IdP, FUXA validates the
response, maps the identity to a FUXA user and then issues **its own token**, exactly as with the
username/password login. Permissions (groups or roles), the `x-access-token` header, the API keys
and the heartbeat work as before. The local login stays available.

## Flow

```
Login dialog ── "SSO" button ──► GET /api/auth/oidc/login
                                   │  state, nonce, PKCE verifier (S256) kept on the server, single use, 10 min
                                   │  fuxa_oidc_state cookie (HttpOnly) binds them to this browser
                                   ▼
                                 IdP authorization endpoint ── user signs in
                                   │
                                   ▼
                                 GET /api/auth/oidc/callback?code&state
                                   │  state = cookie = stored state, one time
                                   │  code + PKCE verifier exchanged at the token endpoint (client secret)
                                   │  ID token: signature (IdP JWKS), iss, aud, exp, iat, nonce
                                   │  userinfo (if the username claim is not in the ID token)
                                   │  identity (sub) ──► FUXA user (linked or created)
                                   │  fuxa_refresh cookie (HttpOnly), as after a local login
                                   ▼
                                 302 to FUXA (postLoginRedirect)
                                   │
                                   ▼
                                 the client calls POST /api/refresh (existing) ──► FUXA token
```

No token is ever put in a URL: the login is completed with the existing refresh cookie flow, so
OIDC requires `enableRefreshCookieAuth: true`.

## Configuration

In `server/_appdata/settings.js` (restart FUXA):

```js
secureEnabled: true,
secretCode: '<strong-random-secret>',
enableRefreshCookieAuth: true,
oidc: {
    enabled: true,
    displayName: 'Company SSO',
    issuer: 'https://idp.example.com/realms/fuxa',
    clientId: 'fuxa',
    clientSecret: '<client secret>',
    redirectUri: 'https://fuxa.example.com/api/auth/oidc/callback',
    scope: 'openid profile email',
    usernameClaim: 'preferred_username',
    groupsClaim: 'groups',
    groupsMapping: { 'fuxa-operators': 'operator', 'fuxa-engineers': 'engineer', 'fuxa-admins': 'admin' },
    autoProvisionUsers: true,
    defaultRole: 'viewer',
    linkExistingUsers: false,
    syncGroupsOnLogin: true,
    tokenEndpointAuthMethod: 'client_secret_basic',
    clockTolerance: 60,
    postLoginRedirect: '/'
},
```

| Setting | Default | Meaning |
|---------|---------|---------|
| `enabled` | `false` | enable the SSO login |
| `displayName` | `'SSO'` | label of the login button |
| `issuer` | | issuer URL; `<issuer>/.well-known/openid-configuration` must exist and its `issuer` must be the same |
| `clientId`, `clientSecret` | | confidential client registered at the IdP (authorization code flow) |
| `redirectUri` | | the public URL of `/api/auth/oidc/callback`, as registered at the IdP (with `BASE_PATH` if used) |
| `scope` | `'openid profile email'` | must include `openid` (add `groups` or the IdP specific scope for the groups claim) |
| `usernameClaim` | `'preferred_username'` | claim used as FUXA username of a new user (`email`, `upn`, ...) |
| `fullnameClaim` | `'name'` | claim used as full name |
| `groupsClaim` | `''` | claim with the IdP groups/roles of the user (array or string), used with `groupsMapping` |
| `groupsMapping` | `{}` | IdP group → FUXA group (`viewer`, `operator`, `engineer`, `supervisor`, `manager`, `f`, `g`, `administrator`, `admin`, or a bitmask). With `userRole: true` the values are FUXA role ids or names. The groups of the user are combined. |
| `autoProvisionUsers` | `true` | create the FUXA user on the first login; `false`: only already linked users can sign in |
| `defaultRole` | `'operator'` | group (or role) of a new user when no group is mapped |
| `linkExistingUsers` | `false` | `true`: an IdP user whose username equals an existing local user signs in as that user (its groups and password are kept). Enable only if the IdP usernames are trusted. |
| `syncGroupsOnLogin` | `false` | `true`: the groups/roles of users created by OIDC (without local password) are recomputed from the claims on every login |
| `tokenEndpointAuthMethod` | `'client_secret_basic'` | or `'client_secret_post'` |
| `clockTolerance` | `60` | seconds of clock skew accepted on the ID token times (0-300) |
| `postLoginRedirect` | `'/'` | FUXA path opened after the login (`/home`, `/editor`, ...) |

### Users

- The identity key is the OIDC subject (`sub`), stored in the new `oidc_sub` column of the `users`
  table of `users.fuxap.db` (unique). The email or username can change at the IdP, the `sub` does not.
- A user created by OIDC has no local password: it cannot sign in with the username/password form
  (until an administrator sets a password in **Users**). The administrator can change its groups or
  roles in **Users** like for any user (overwritten on the next login only with `syncGroupsOnLogin`).
- The username is the `usernameClaim` value: letters, digits and `. _ @ + -`, 1-64 characters.
  `guest` is reserved. If a local user with the same username exists and is not linked to this
  identity, the login is refused (unless `linkExistingUsers`).
- Removing the user in **Users** removes the link; with `autoProvisionUsers` a new one is created
  on the next login.

### Database change

`oidc_sub TEXT` and the unique index `idx_users_oidc_sub` (on the rows with a value) are added to
`users.fuxap.db` on the start when `oidc.enabled` is `true`. The change is additive: older FUXA
versions ignore the column. To remove it: `DROP INDEX idx_users_oidc_sub; ALTER TABLE users DROP COLUMN oidc_sub;`
(SQLite 3.35+).

## Security

| Requirement | Implementation |
|-------------|----------------|
| Authorization code flow with **PKCE** (S256) | always; the login is refused if the IdP announces PKCE methods without `S256` |
| **state** and **nonce** | random per login, kept on the server, single use, expire after 10 minutes, bound to the browser with the `fuxa_oidc_state` HttpOnly SameSite=Lax cookie; a callback without the same state in the query, the cookie and the server is refused |
| **ID token validation** | signature verified with the IdP JWKS (`enableNonRepudiationChecks`), `iss`, `aud`, `azp`, `exp`, `iat`, `nonce` checked by `openid-client`, `clockTolerance` |
| **No `Host` / `Referer` trust** | the callback URL is built from `oidc.redirectUri`, the redirect after login from `BASE_PATH` + `postLoginRedirect` (a validated relative path); request headers are never used to build URLs or to authenticate |
| **Client secret** | only in the server settings; removed from `/api/settings`; the OIDC code never logs it (see the known issue below) |
| **`sub` is the identity** | users are looked up by `sub`; the username is only used to name a new user |
| **No silent account takeover** | an IdP username equal to an existing local user (e.g. `admin`) is refused unless `linkExistingUsers` |
| **Rate limit** | `/api/auth/oidc/login` and `/callback` use the `authRateLimitWindowMs` / `authRateLimitMax` limit of the sign-in |
| **TLS** | issuer and redirect URI must be `https`; `http` is accepted only for `localhost` (development) |
| **Audit log** | `oidc-login: success sub=... username=...` and `oidc-login: failed reason=... sub=...` in the FUXA log, plus the `access:login` event; no token, code or claim set is logged |
| **Fail closed** | FUXA does not start if `oidc.enabled` is `true` and `secureEnabled`, `enableRefreshCookieAuth` or a required OIDC setting is missing or invalid. If `secureEnabled` or `enableRefreshCookieAuth` are disabled later from the editor, the OIDC routes stop working. If the IdP cannot be reached the SSO login fails, the local login keeps working. |

### Known issue: settings in the DAQ log line

`server/runtime/storage/daqstorage.js` writes the whole settings object to the FUXA log on start
(`daqstorage: settings - {...}`), including `secretCode`, the SMTP password and, with OIDC,
`oidc.clientSecret`. This line predates OIDC and is outside the scope of this change; until it is
fixed, protect the `_logs` folder like the settings file.

### Local administrator

With OIDC the local login stays enabled: change the default `admin` / `123456` password, or
the local administrator is the weakest way in. Prefer `linkExistingUsers: false` and an
administrator mapped from an IdP group (`groupsMapping: { 'fuxa-admins': 'admin' }`).

### Logout

Sign out in FUXA clears the FUXA session (refresh cookie). The IdP session is not ended: a new
click on the SSO button signs in again without a password while the IdP session is valid.
