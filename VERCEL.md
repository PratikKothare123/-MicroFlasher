# 🚀 Deploying Microcontroller Code Flasher to Vercel

This repository is pre-configured for Vercel deployment via `vercel.json` and Serverless Express handlers.

---

## ⚡ Deployment Options

### Option 1: Deploy using Vercel CLI (Recommended)

1. **Install Vercel CLI**:
   ```bash
   npm install -g vercel
   ```

2. **Deploy to Preview Environment**:
   Run the `vercel` command from the project root:
   ```bash
   vercel
   ```
   Follow the interactive prompts to link your project and deploy.

3. **Deploy to Production**:
   ```bash
   vercel --prod
   ```

---

### Option 2: Deploy via Vercel Web Dashboard (GitHub / GitLab / Bitbucket)

1. Push this repository to GitHub or your preferred Git provider.
2. Log into your [Vercel Dashboard](https://vercel.com).
3. Click **Add New...** -> **Project**.
4. Import your GitHub repository.
5. Keep default settings (Vercel automatically detects `vercel.json`).
6. Click **Deploy**.

---

## ℹ️ Important Architecture Notes for Vercel

> [!NOTE]
> - **Frontend (Web Serial Flashing)**: The HTML/CSS/JS frontend runs **100% in the user's browser**. End-users can connect microcontrollers and flash `.bin`/`.hex` binaries over Web Serial API directly on your live Vercel domain!
> - **Serverless Storage**: Serverless functions write temporary binaries to `/tmp`. For persistent long-term storage in serverless environments, you can optionally connect cloud storage (S3 / Cloudinary / Supabase Storage) for binaries and a serverless database (Supabase / Neon Postgres / Vercel Postgres).
> - **Serverless Compilation**: Heavy live C++ compilation with `arduino-cli` requires compiler toolchains. For high-volume serverless compilation, host the compilation backend service on Render, Railway, or VPS, or use pre-compiled binaries in your catalog!
