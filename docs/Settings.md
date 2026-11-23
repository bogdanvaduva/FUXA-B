Server settings are located in 'server\\_appdata\settings.js' file. You have to restart the server after your change.

### Authentication
To enable and config the authentication:

```
secureEnabled: true,            // enable or diasable
secureOnlyEditor: false,        // if true, sign-in is required only for the Editor and admin pages, values can be changed by anyone
secretCode: '<strong-random-secret>', // secret code to encode the token
tokenExpiresIn: '1h'            // token expiration delay '1h'=1hour, 60=60seconds, '1d'=1day
```

The default user ‘admin’ have the ‘123456’ as password, of course you can change it.

### Project storage
The project (views, devices, scripts, alarms, ...) is saved by default in the SQLite file `_appdata/project.fuxap.db`.
To save it in a PostgreSQL database:

```
storage: {
    type: 'postgres',           // 'sqlite' (default) | 'postgres'
    postgres: {
        host: 'localhost',
        port: 5432,
        database: 'fuxa',
        user: 'fuxa',
        password: '',
        ssl: false,             // or the node-postgres ssl options
        maxPoolSize: 10,
        // schema: 'fuxa',      // default public
    }
},
```

The storage can also be switched from the editor (**Setup → Settings → Project storage**): the project is copied to the new storage automatically, both ways. See [Project storage migration](storage-migration.md).

### Single sign-on (OpenID Connect)
Sign in with an external identity provider (Keycloak, Entra ID, Okta, ...). Requires `secureEnabled: true` and `enableRefreshCookieAuth: true`.

```
oidc: {
    enabled: true,
    displayName: 'Company SSO',
    issuer: 'https://idp.example.com/realms/fuxa',
    clientId: 'fuxa',
    clientSecret: '<client secret>',
    redirectUri: 'https://fuxa.example.com/api/auth/oidc/callback',
    defaultRole: 'operator',
},
```

All the options, the user mapping and the security notes: [OpenID Connect single sign-on](oidc-security.md).
