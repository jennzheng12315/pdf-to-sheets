# BOA Statement to Google Sheets Converter

A full-stack web application that parses Bank of America PDF bank statements and converts them into labeled Google Sheets spreadsheets.

## Features

- **Google OAuth Sign-In**: Secure authentication with Google account
- **PDF Upload & Parsing**: Drag-and-drop upload of BOA PDF statements
- **Transaction Labeling**: Categorize payees as "Operation" or "Inventory"
- **Google Sheets Export**: One-click export to your Google Drive with formatted sheets

## Tech Stack

- **Framework**: Next.js 14+ with App Router
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Auth**: NextAuth.js with Google OAuth
- **PDF Parsing**: `pdfjs-dist` for text extraction, `tesseract.js` for OCR on check images
- **Google APIs**: `googleapis` package for Sheets and Drive integration

## Getting Started

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables (see `.env.example`):
```
AUTH_SECRET
AUTH_GOOGLE_ID
AUTH_GOOGLE_SECRET
```

3. Run the development server:
```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000) in your browser.

## TODO

- [ ] **Extracting names from check images** - Use OCR to read "Pay to the Order of" names from check images in the PDF
- [ ] **Auto-populating known categorizations** - Remember and automatically apply previous labeling choices for recurring payees
- [ ] **Creating spreadsheet in a specific folder** - Allow users to select a destination folder in Google Drive instead of root

## Deployment

The easiest way to deploy is using the [Vercel Platform](https://vercel.com/new). Ensure all environment variables are set in your hosting platform.
