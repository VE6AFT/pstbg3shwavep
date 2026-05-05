# 🗺️ Protospace Space Board The Board Game 3, Space Hard With A Vengeance Expansion Pack

> [!CAUTION]
> **DO NOT deploy this on a paid or billable Cloudflare plan.**
> This project provides "authoring convenience" but has **no security or authentication**. It is strictly for prototyping; deploying it on a billable plan may expose you to unexpected costs or data risks.

A high-performance, shareable floorplan editor built for rapid layout prototyping and fitment testing.

## 🚀 Live Access

- **Production:** [bg.ps.ai](https://bg.ps.ai) (Deploys from `main`)
- **Staging/Preview:** [dev.pstbg3shwavep.pages.dev](https://dev.pstbg3shwavep.pages.dev) (Deploys from all other branches)

---

<img width="539" height="340" alt="image" src="https://github.com/user-attachments/assets/6e83c883-3bd1-4e5a-a3c8-2716fb6f0eda" />


### ✅ Must Have
- **Shareable floorplan editing**: Real-time collaboration and easy sharing via unique URLs.
- **Clone & Riff**: One-click cloning of any public floorplan to start your own version.
- **SVG Export**: High-quality vector exports for documentation and presentations.

## 📋 ToDo

### 📈 Should Have
- **Mobile Read-Only**: Smooth viewing experience on mobile devices.
- **Dynamic Dimension Callouts**: Visual feedback for shapes during drag/resize (making it "pretty").
- **Fitment Presets**: Pre-configured shapes for common objects (car, truck, bicycle, human).

### ✨ Could Have
- **Mobile Editing**: Touch-friendly editing controls for on-the-go adjustments.
- **SVG Import**: Bring existing vector assets into your floorplan.
- **Enhanced Selection**: Multi-select box and improved active selection states.
- **Grouping**: Group and ungroup multiple shapes for easier management.
- **Advanced Geometry**: Support for circles and custom polygon shapes.
- **Tutorial Flow**: A single-page onboarding experience featuring a newly cloned tab view, automatic zoom-out, and a pulsing, annotated overlay of core functions (spin shape, garbage can, add, etc.).

### 🚫 Won't Do
- **Stateful Viewports**: Storing/sharing user-specific zoom or pan levels.
- **Lineage Tracking**: "Cloned from" metadata (removed due to database complexity).
- **Push Sync**: Real-time broadcast of metadata updates (refresh the page instead).
- **Poll Sync**: Continuous database polling for updates.

---

## 💻 Local Development

This project is built with **React**, **Vite**, and **Cloudflare Pages**.

### Getting Started

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Run Development Server**:
   ```bash
   npm run dev
   ```

3. **Database Setup (Local)**:
   ```bash
   npm run db:migrate:local
   npm run db:seed:local
   ```

### Scripts

- `npm run dev`: Start Vite dev server.
- `npm run test`: Run Vitest suite.
- `npm run build`: Build for production.
- `npm run cf:dev`: Run Cloudflare Workers/Pages dev environment (Wrangler).

---

## 🤖 Built With

A collaborative effort between humans and various AI models:
- **Initial Concept**: Gemini 3.1 Pro (High)
- **Bulk Work & Review**: GPT-5.5 (High)
- **Minor Tweaks**: Gemini 3 Flash
- **Occasional Touches**: Claude Opus 4.6 & Sonnet 4.6 (Thinking)
