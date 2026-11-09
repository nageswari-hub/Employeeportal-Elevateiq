# Employee Portal

Modern, responsive Next.js frontend application for the ElevateIQ Employee Portal (TeamFlow).

## Tech Stack
- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Realtime**: Socket.io Client

## Features
- **Dashboard**: Centralized hub for attendance, announcements, pending reviews, and tasks.
- **Attendance & Breaks**: Daily check-in/out and break tracking with live timers.
- **Task Management**: Kanban and list views with review flow and file attachments.
- **Daily Reports**: End-of-day report submissions and streak tracking.
- **Chat & Channels**: Realtime chat across company, team, and batch channels.
- **Projects & Tickets**: Project planning, tracking, and issue ticketing.
- **People & Teams**: Team rosters, batch evaluations, and user management.
- **Assessments & Training**: Day-wise training modules and quizzes.

## Getting Started

### 1. Configure Environment
Copy `.env.example` to `.env.local`:
```bash
cp .env.example .env.local
```
Ensure `BACKEND_URL` points to your backend API service (defaults to `http://localhost:4001` if unset).

### 2. Install Dependencies
```bash
npm install
```

### 3. Run Development Server
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## API Proxying
In development, Next.js automatically rewrites `/backend/*` to `${BACKEND_URL}/api/*` and proxies WebSockets at `/socket.io`, ensuring cookies remain first-party without CORS complications.
