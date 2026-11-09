# TeamFlow frontend redesign — what changed

Drop-in for `apps/web`. API calls, auth, sockets, middleware logic and package.json deps are unchanged.

New / rewritten
- Design system: tailwind.config.js (ElevateIQ orange + blue + navy, Poppins), app/globals.css (card, btn, input… restyled, so ALL pages get the new look)
- App shell: components/Shell.tsx (sidebar by role, mobile drawer, top bar) — replaces components/Nav.tsx (deleted)
- components/ui.tsx (badges, avatars, stats, progress, donut chart, modal), components/AuthFrame.tsx
- Pages: login, change-password, dashboard (all 4 roles), tasks (board + list + create modal with team/person pickers), tasks/[id] (stepper, unblock/approve/send-back with note), reports, channels (chat UI), users, teams
- NotifBell restyled (click-to-read, unread dot)
- middleware.ts: static images (logo) no longer redirected to /login
- Poppins bundled locally (app/fonts) — no Google Fonts fetch at build, works in Docker offline

Restyled only via global CSS (logic untouched): goals, batches, training, assessments, announcements
