# Kifayat

Kifayat is now developed as a mobile-only, local-first Expo application. The application, installation guide, architecture, database migration details, validation commands, AI security requirements, and known limitations are documented in [mobile/README.md](mobile/README.md).

```sh
cd mobile
npm install
npm start
```

Financial data is stored on-device with Expo SQLite and Drizzle ORM. No API server is required for accounts, transactions, summaries, planning, forecasts, or risk analysis. Optional AI generation requires a separately operated secure backend so private API keys are never bundled into the app.
