# Secure TelePayments Bridge Bot

A secure Telegram Payment Bridge Bot built with **Next.js 14+ (App Router)**, **TypeScript**, **Mongoose**, and **grammY**. Designed for high-risk environments with strict liability protection and atomic transactions.

## Features

- **🛡️ Liability Protection**: "Stop & Think" payment flows with mandatory friction and explicit Terms of Service (ToS) acceptance.
- **⚛️ Atomic Transactions**: Uses MongoDB Sessions to ensure payments are processed safely. (Requires MongoDB Replica Set).
- **🌏 Internationalization (i18n)**: Full support for **English** and **Burmese** (auto-detected).
- **👮 Admin Tools**: `/freeze` accounts and `/audit` transactions.
- **⚡ Serverless Ready**: Deploys easily to Vercel/Next.js environment.

## Tech Stack

- **Framework**: Next.js 14+ (App Router)
- **Language**: TypeScript
- **Database**: MongoDB (Mongoose) with Transactions
- **Bot Framework**: grammY

## Prerequisites

- **MongoDB Replica Set**: Essential for Atomic Transactions. Standalone instances will error.
- **Node.js 18+**

## Environment Variables

Create a `.env.local` file:

```env
MONGODB_URI=mongodb+srv://user:pass@host/db?retryWrites=true&w=majority
TELEGRAM_BOT_TOKEN=your_bot_token
```

## Getting Started

1.  **Install Dependencies**:
    ```bash
    npm install
    ```

2.  **Run Development Server**:
    ```bash
    npm run dev
    ```

3.  **Setup Webhook**:
    Using `ngrok` or similar, or deploy and set:
    ```bash
    curl https://api.telegram.org/bot<TOKEN>/setWebhook?url=<YOUR_DOMAIN>/api/bot
    ```

## Usage

- **/start**: Onboarding and ToS acceptance.
- **/become_merchant**: Register as a merchant.
- **Payment Link**: `/start pay_MERCHANTID_AMOUNT` (Amount in cents).
