# Kifayat Mobile

Kifayat Mobile is a genuine Expo/React Native frontend for the existing Kifayat Next.js backend. It does not embed the website in a WebView and does not import Prisma or Next.js code.

## Architecture

- Expo SDK 57 + React Native 0.86
- Expo Router native navigation
- Four native screens: Overview, Transactions, Planning, and Kifayat Chat
- Typed HTTP client in `src/lib/api.ts`
- Existing Next.js APIs, Prisma database, finance rules, forecast engine, RAG, and Groq integration remain server-side

## Assignment 2 navigation flow

Kifayat uses a root Stack Navigator containing the main Bottom Tab Navigator, Add Transaction, and Transaction Details screens. The Transactions header button pushes the add screen, while tapping a row passes its ID and source route parameters to the details screen.

```text
Root Stack
├── Bottom Tabs
│   ├── Overview
│   ├── Transactions
│   ├── Planning
│   └── Kifayat Chat
├── Add Transaction
└── Transaction Details ([id])
```

The details screen reads the route parameters with `useLocalSearchParams` and fetches the matching record from `/api/transactions/:id`. Returning from Add Transaction refreshes the transaction list, so the navigation demonstration is part of the real finance workflow rather than a separate sample.

## Physical phone setup

1. Install Expo Go on the phone.
2. Connect the phone and computer to the same trusted Wi-Fi.
3. In the repository root, start the backend:

   ```powershell
   npm run dev:phone
   ```

4. Run `ipconfig` and note the active IPv4 address.
5. Set `EXPO_PUBLIC_API_URL` in `mobile/.env` to `http://YOUR_IPV4:3000`.
6. In another terminal, start Expo:

   ```powershell
   cd mobile
   npx expo start
   ```

7. Scan the QR code with Expo Go.

If Windows Firewall asks, allow Node.js only on private networks. Do not use `localhost` in `mobile/.env`; on a physical phone, `localhost` means the phone itself.

## Secrets

Never put `GROQ_API_KEY` in the mobile app or in an `EXPO_PUBLIC_` variable. The key belongs only in the backend root `.env`. Expo public variables are compiled into the client bundle.

## Verification

```powershell
npm run typecheck
npm run lint
npx expo-doctor
npx expo export --platform android
```

## Production path

Local phone testing uses the laptop backend. A distributed app requires a hosted HTTPS backend, authentication, and a hosted database. EAS Build can generate installable Android/iOS builds once those services are ready.
