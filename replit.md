# SkOla — Interactive Learning Platform

## Project Overview
SkOla is an interactive educational platform for Norwegian lower secondary school students (*ungdomsskole*). It provides quizzes, flashcards, writing assignments, word clouds, and educational games (Wordle, Worldle, "Who Am I?").

## Tech Stack
- **Language:** Vanilla JavaScript (ES2020+), HTML5, CSS3
- **Build Tool:** esbuild (via custom `build.mjs` script)
- **Package Manager:** npm
- **Backend/Database:** Supabase (external), LocalStorage for session persistence
- **External APIs:** Anthropic API (AI content), dictionary APIs
- **PWA:** Service Worker + Web App Manifest

## Project Structure
```
.
├── app.js          # Main application logic (~8000 lines)
├── games.js        # Lazy-loaded games bundle (Wordle, Worldle, etc.)
├── app.css         # Core styles and CSS variables
├── index.html      # SPA entry point
├── build.mjs       # esbuild build pipeline with content hashing
├── sw.js           # Service Worker for offline/PWA
├── manifest.json   # PWA manifest
├── dist/           # Built output (served in production)
└── package.json    # Dependencies and scripts
```

## Build & Run
- **Install:** `npm install`
- **Build:** `npm run build` → outputs to `dist/` with content-hashed filenames
- **Dev (watch):** `npm run build:watch`
- **Serve:** `serve dist -l 5000 -s`

## Workflow
- **Start application:** `serve dist -l 5000 -s` on port 5000 (webview)

## Deployment
- **Type:** Static site
- **Build command:** `npm run build`
- **Public directory:** `dist/`
