# JS Store POS

JS Store is a plain JavaScript point-of-sale app for a small shop or retail counter. It includes user logins, role-based access, receipt printing, product management, offline sale queueing, and manager reporting.

## What this app does

- Lets cashiers ring up sales quickly from a product grid
- Supports cash and card payments
- Shows totals with tax and role-based discount limits
- Saves cart data locally so a cashier can keep selling while offline
- Syncs queued sales automatically when the connection returns
- Gives managers access to products, staff accounts, refunds, reports, and shop settings
- Prints receipts to a thermal printer when connected, or opens the browser print dialog otherwise

## Prerequisites

- Node.js 18 or newer
- A browser such as Chrome or Edge for direct thermal printer support
- Optional local printer hardware for receipt printing

## Quick start

From the project root:

```bash
npm run install:all
npm start
```

Then open:

```text
http://localhost:4000
```

The app starts a local web server and serves the POS interface in the browser.

## First run and setup

When the app is started for the first time, it creates a default manager account automatically.

The terminal output includes:

```text
First run: manager account created.
  username: manager
  password: <generated-password>
```

You can also set your own initial manager password in the environment:

```bash
POS_ADMIN_PASSWORD=MyStrongPassword npm start
```

After logging in for the first time:

1. Sign in with the manager account.
2. Open the Password button or profile action to change the default password.
3. Add staff accounts under the Staff screen.
4. Add products before starting normal sales.

## User roles

| Role | Can ring up sales | Discount limit | Can view sales list | Can refund | Can run daily report | Can manage staff |
|---|---|---:|---|---|---|---|
| Cashier | Yes | 10% | No | No | No | No |
| Manager | Yes | 100% | Yes | Yes | Yes | Yes |

This is enforced by the server on every API request, so a cashier cannot bypass manager-only actions even if the browser is manipulated.

## Logging in

Use the username and password created at first run or a staff account created by the manager.

- Passwords are stored using scrypt with a unique salt per user.
- Failed logins are temporarily locked after repeated attempts.
- Each login requires a valid signed token.
- Tokens expire after 12 hours.
- A manager can disable a user account if needed.

## Sales workflow

### 1. Search and add products

- Use the search field to filter products by name or SKU.
- Tap a product tile to add it to the cart.
- Use the cart controls to increase or decrease quantity.
- Empty carts are allowed; the system only processes a sale when items exist.

### 2. Adjust pricing and discounts

- The discount field is limited by the current user role.
- Cashiers can only discount up to 10%.
- Managers can discount up to 100% if needed for a manual override.
- Totals update in real time as the cart changes.

### 3. Choose payment method

When ready, choose either:

- Cash
- Card

The app calculates subtotal, discount, tax, and total before finalizing the sale.

### 4. Receipt and printing

After checkout:

- A receipt preview appears in the app.
- A connected printer can print automatically if enabled in printer settings.
- If no printer is connected, the browser print dialog opens.
- The last receipt can be reprinted from the POS controls when needed.

## Offline sales behavior

The app is designed to keep working when the internet connection is lost.

- Sales are still allowed while signed in and offline.
- The cart is saved locally in browser storage.
- Transactions queued for sync are sent to the server when the connection returns.
- If the server rejects a sale, the failed queue is visible to the manager for review.

This makes the POS useful in environments with unreliable connectivity.

## Manager menu

Managers can open the Manager menu from the main app.

### Products and stock

- Add new products with SKU, name, price, tax rate, and stock
- Update product price or tax settings
- Mark products as active or inactive
- Track stock changes for inventory visibility

### Sales and refunds

- View recent sales
- Reprint receipts from prior orders
- Refund paid orders when approved

### Today’s report

The daily report shows:

- total sales count
- total revenue
- tax collected
- totals by payment method
- totals by cashier

### Staff

Managers can:

- create new staff users
- assign cashier or manager roles
- set password requirements
- disable or re-enable accounts

### Shop and receipt details

Managers can edit:

- store name
- address
- phone number
- receipt footer
- currency code

## Security and operational notes

- Passwords use scrypt with a per-user salt.
- API tokens are HMAC-signed with a 12-hour expiry.
- User roles are checked on every request to prevent privilege escalation.
- The app locks a user out for one minute after five failed login attempts.
- In production, the app should be served over HTTPS.
- Set POS_SECRET if you want tokens to remain valid across app restarts or redeployments.

## Recommended first-day workflow

1. Start the server.
2. Sign in as manager.
3. Change the default manager password.
4. Add products and prices.
5. Add cashier staff accounts.
6. Verify the shop settings and receipt formatting.
7. Run a test sale and confirm the receipt prints correctly.
8. Check daily reports after real transactions.

## Useful commands

```bash
npm run install:all   # install server-side dependencies
npm test              # run the test suite
npm start             # start the POS server
```

## Troubleshooting

### Cannot log in

- Confirm that the username and password are correct.
- If the login fails repeatedly, wait one minute for the lockout to clear.
- Check that the server is running and you are connected to the same local network.

### No products show up

- Add products from the manager menu.
- Make sure the product is marked active.
- Confirm the product grid is not filtered to a search term.

### Sales are not syncing

- Check the browser connection status.
- Wait until the device reconnects to the network.
- Review failed queued sales in the app status.

### Printer does not print

- Confirm the printer is connected and supported by the browser.
- Open the Printer settings screen and choose the correct connection method.
- If no printer is available, use the browser print dialog as a fallback.

## Notes for developers

This repository is split into a few main parts:

- public: browser UI and client-side logic
- server: authentication, API endpoints, and data persistence
- shared: shared rules and cart logic
- scripts: tests and browser/service-worker checks

The project intentionally keeps the stack simple: no framework, no heavy dependencies, and a lightweight POS workflow suitable for small retail usage.

## Summary

JS Store is intended to be a straightforward retail POS with secure logins, realistic permission checks, and enough offline resilience to remain useful in the field. Once the default manager account is secured and a few products are added, the app is ready for daily cashier use.
