# JS Store: plain JavaScript POS with logins and roles

```
npm run install:all
npm test
npm start          # http://localhost:4000
```

First run prints the `manager` password in the terminal (or set POS_ADMIN_PASSWORD).
Sign in, change it with the Password button, then add staff under Staff.

| | Cashier | Manager |
|---|---|---|
| Ring up sales | yes | yes |
| Discount limit | 10% | 100% |
| Sales list + refunds | no | yes |
| Daily report | no | yes |
| Staff accounts | no | yes |

Security notes
- Passwords: scrypt + per-user salt. Tokens: HMAC-signed, 12h expiry. Role is re-checked on every request.
- Login locks for 1 minute after 5 failed tries.
- Serve over HTTPS in production. Set POS_SECRET so tokens survive restarts and redeploys.
- Signing in needs a connection. Once signed in, selling continues offline until the token expires.
