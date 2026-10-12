# Kifayat

Kifayat is an AI-assisted personal finance application built for web and mobile. It helps a demo user review income and expenses, inspect financial risk, forecast spending, evaluate purchases, manage transactions, and ask questions about their financial data.

The repository contains two clients sharing one backend:

- A Next.js web application and API server at the repository root.
- A native Expo/React Native application in [`mobile/`](mobile/README.md).

The mobile application is built with native React Native components. It is not a WebView or a wrapper around the website.

## Main features

- Financial overview with balances, spending, income, savings rate, and risk indicators
- Transaction browsing, creation, account selection, and transaction details
- Spending forecasts with category-level estimates
- Affordability analysis with emergency-buffer protection
- Groq-powered financial chat grounded in server-side finance tools
- Local transaction retrieval using Hugging Face embeddings
- Responsive Next.js web interface
- Native Expo application for Android and iOS
- Stack and Bottom Tab navigation with route parameters and custom headers

## Technology stack

### Mobile

- Expo SDK 57
- React Native 0.86
- React 19
- Expo Router
- TypeScript

### Web and backend

- Next.js 16 App Router
- React 19
- TypeScript
- Prisma 6
- SQLite
- Tailwind CSS
- Recharts

### AI and financial logic

- Groq through the Vercel AI SDK
- Hugging Face Transformers.js for local embeddings
- Deterministic finance rules for risk, affordability, savings, and monthly health
- EWMA and linear-trend spending forecasts

## Architecture

```text
Kifayat/
├── mobile/                         Expo/React Native client
│   ├── src/app/                    Screens and Expo Router layouts
│   ├── src/components/             Shared native UI components
│   ├── src/hooks/                  Mobile data-loading hooks
│   └── src/lib/                    Typed API client and mobile types
├── prisma/                         Prisma schema and local SQLite database
├── scripts/                        Seed, embedding, and inspection scripts
├── src/app/                        Next.js pages and API routes
├── src/components/                 Web UI components
├── src/lib/                        Database, finance, forecast, RAG, and chat logic
└── tests/                          Finance-rule regression tests
```

The mobile client calls the Next.js API over HTTP. Prisma, SQLite, Groq credentials, embeddings, and financial business logic remain on the server and are not bundled into the mobile application.

## Mobile navigation

Kifayat uses two navigator types:

```text
Root Stack Navigator
├── Bottom Tab Navigator
│   ├── Overview
│   ├── Transactions
│   ├── Planning
│   └── Kifayat Chat
├── Add Transaction
└── Transaction Details ([id])
```

The Transactions header contains an **Add** button that opens the Add Transaction screen. Selecting a transaction passes its ID and source as route parameters to the Transaction Details screen, which reads the parameters and retrieves the authoritative record from the backend.

## Requirements

- Node.js 22.13 or newer for Expo SDK 57
- npm
- Expo Go on a physical phone, or an Android/iOS development environment
- A Groq API key for AI chat
- Phone and development computer on the same Wi-Fi network for LAN testing

## Environment configuration

Create a root `.env` file based on [`.env.example`](.env.example):

```env
GROQ_API_KEY="your_groq_api_key"
GROQ_MODEL="openai/gpt-oss-120b"
DATABASE_URL="file:./dev.db"
FINANCE_AS_OF_DATE="2026-05-10"
```

Create `mobile/.env` based on [`mobile/.env.example`](mobile/.env.example):

```env
EXPO_PUBLIC_API_URL=http://YOUR_COMPUTER_IPV4:3000
```

Find the computer's active Wi-Fi address on Windows with:

```powershell
ipconfig
```

Do not put `GROQ_API_KEY` in the mobile environment file or any `EXPO_PUBLIC_` variable. Expo public variables are included in the client bundle.

## Installation

Install the web/backend dependencies:

```powershell
npm install
```

Install the mobile dependencies:

```powershell
cd mobile
npm install
cd ..
```

Initialize the local database when setting up a fresh clone:

```powershell
npx prisma migrate dev
npx tsx scripts/seed.ts
```

Optional: precompute embeddings used by transaction retrieval:

```powershell
npx tsx scripts/embed_all.ts
```

The embedding command may download the configured model on its first run.

## Running the project

Start the backend and web application in the first terminal:

```powershell
npm run dev:phone
```

Start Expo in a second terminal:

```powershell
cd mobile
npm start -- --lan
```

Scan the displayed QR code with Expo Go. If Windows Firewall asks for access, allow Node.js only on trusted private networks.

Web application:

```text
http://localhost:3000
```

For a physical phone, use the computer's LAN address instead of `localhost`, for example:

```text
Backend: http://192.168.1.5:3000
Expo:   exp://192.168.1.5:8081
```

The IP address may change when reconnecting to Wi-Fi. Update `mobile/.env` when that happens.

## Available commands

### Web and backend

```powershell
npm run dev             # Start Next.js locally
npm run dev:phone       # Start Next.js on LAN interfaces
npm run typecheck       # Type-check web/backend code
npm run lint            # Lint web/backend code
npm test                # Run finance regression tests
npm run build           # Create a production web build
npm run check           # Run the complete web/backend check
```

### Mobile

Run these commands from `mobile/`:

```powershell
npm start               # Start Expo
npm run typecheck       # Type-check mobile code
npm run lint            # Lint mobile code
npm run check           # Run mobile type-check and lint
npx expo-doctor         # Validate Expo configuration
npx expo export --platform android
```

## Verification status

The following checks were completed successfully during development:

- Mobile TypeScript and ESLint
- Expo Doctor: 21/21 checks
- Android Expo/Hermes bundle export
- Web/backend TypeScript and ESLint
- Six finance regression tests
- Next.js production build
- LAN API and Expo manifest requests
- Transaction ID parameter and details API flow
- Browser CORS request and preflight handling

Always run the checks again after cloning or making changes because dependency, environment, and operating-system differences can affect results.

## Data and external services

- The development database is local SQLite and is not committed.
- Seed data represents a synthetic Pakistani personal-finance profile.
- Groq is the only required external AI service for chat.
- Local embeddings do not require a vector database.
- The finance API currently operates as a single demo user.

## Known limitations

- Authentication and multi-user authorization are not implemented.
- The application does not connect to real banks.
- The mobile client depends on the development computer while using the local backend.
- A public release requires a hosted HTTPS backend and production database.
- Forecasting is based on a small demo dataset and should not be treated as financial advice.
- Store distribution still requires final branding assets, signing, privacy documentation, and EAS configuration.

Do not expose the local development server directly to the public internet.

## Documentation

- [Mobile setup and navigation](mobile/README.md)
- [Software requirements specification](SRS.md)
- [Example backend environment](.env.example)
- [Example mobile environment](mobile/.env.example)

## License

This project is intended for educational and university-assignment use. Add an explicit repository license before redistribution or commercial use.
