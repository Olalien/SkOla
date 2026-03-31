# Security Notes

This document summarizes the security hardening currently implemented in `index.html` and highlights remaining risks and next steps.

## Implemented

### 1) Teacher Authentication

- Replaced hardcoded plaintext password with PBKDF2-based hashing.
- Added `SecurityUtils` methods:
  - `generateSalt()`
  - `hashPassword(password, salt)` using PBKDF2 (100,000 iterations, SHA-256)
  - `verifyPassword(password, storedHash, salt)`
- Stores teacher auth data in `localStorage` key `os_teacher_auth` as:
  - `{ salt, hash }`
- Added first-run setup modal for creating the initial teacher password.
- Added password change flow in Settings (writes new hashed value).

### 2) Login Brute-Force Mitigation

- Tracks failed attempts in `sessionStorage` key `os_login_attempts`.
- Enforces temporary lockout after 5 failed attempts.
- Lockout duration: 30 seconds.
- Visible countdown in teacher login modal.
- Attempt counter resets on successful login.

### 3) Encryption of Sensitive Local Data

- Extended `SecurityUtils` with AES-GCM utilities:
  - `deriveEncryptionKey(password)` (PBKDF2-derived AES-256 key)
  - `encrypt(data, key)` -> `{ iv, ciphertext }`
  - `decrypt(ciphertext, key, iv)`
- Encrypted storage:
  - `olaskole_apikey` (AI API key)
  - `os_sb_url` (Supabase URL)
  - `os_sb_key` (Supabase anon key)
- Decrypted values are cached in memory for active session only.
- Re-authentication/login is required if in-memory key is unavailable.

### 4) Session Inactivity Controls

- Tracks teacher activity and updates `lastActive`.
- Warning at 25 minutes inactivity.
- Auto-logout at 30 minutes inactivity.
- Clears in-memory decrypted secrets and session crypto key on logout.

### 5) XSS Hardening

- Added sanitization helpers:
  - `sanitizeHTML(input)`
  - `sanitizeForAttribute(input)`
  - `createSafeElement(tag, text)`
- Updated key UI paths to reduce unsafe interpolation:
  - Teacher results rendering now uses DOM construction.
  - Word cloud/poll rendering and response list use DOM construction for user text.
  - Quiz answer click flow avoids inline explanation injection.
  - AI error display paths now sanitize interpolated text.
  - DOCX preview content from Mammoth is sanitized before insertion.
- Added YouTube URL validation before embed extraction and iframe usage.

### 6) Client-Side Security Headers (Meta)

- Added CSP meta tag restricting sources while allowing `'unsafe-inline'` for current single-file architecture.
- Added:
  - `<meta name="referrer" content="strict-origin-when-cross-origin">`
- Added inline TODO comment noting future CSP tightening work.

## Current Limitations / Residual Risk

- `'unsafe-inline'` is still enabled in CSP due single-file architecture and inline handlers.
- Secrets are protected at rest in localStorage, but client-side encryption remains limited by browser execution context (malicious scripts in same origin can still access runtime state).
- Some legacy `innerHTML` usage still exists in non-critical UI paths and should be progressively migrated to DOM-based rendering.
- Supabase anon key in client is expected for public frontend use, but should still be scoped via strict RLS policies.

## Recommended Next Steps

1. Migrate remaining inline `onclick` / inline script patterns to event listeners.
2. Move script/style out of inline blocks, then remove `'unsafe-inline'` from CSP.
3. Add Subresource Integrity (SRI) hashes for CDN resources where possible.
4. Add an optional backend proxy for AI API requests to avoid exposing direct browser key usage.
5. Add automated security checks (lint rules for unsafe DOM APIs, dependency auditing, and basic CSP tests).
6. Add explicit UI for "re-authenticate to unlock secrets" to improve recovery UX after reload/idle.

## Storage Keys (Security-Relevant)

- `os_teacher_auth` -> `{ salt, hash }`
- `os_teacher_session` -> session metadata (`loggedInAt`, `lastActive`)
- `os_login_attempts` -> failed login counter/lockout metadata
- `olaskole_apikey` -> encrypted `{ iv, ciphertext }`
- `os_sb_url` -> encrypted `{ iv, ciphertext }`
- `os_sb_key` -> encrypted `{ iv, ciphertext }`

