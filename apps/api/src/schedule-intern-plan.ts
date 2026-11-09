import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

type Block = { title: string; steps: string[]; outcome: string };
type PlanDay = {
  theme: string;
  mission: string;
  learn: Block;
  build: Block;
  deliverable: string;
  resources: string;
  milestone?: boolean;
};

const PROJECT_NAME = '15-Day Website & Web App Foundations';
const DEFAULT_TEAM = 'Web Foundations Interns';
const DEMO_PASSWORD = 'Intern1234x';

const PLAN: PlanDay[] = [
  {
    theme: 'How the web works + your first page',
    mission: 'Understand what happens when you open a website, then publish your first HTML page.',
    learn: {
      title: 'How the web works and dev setup',
      steps: [
        'Read how a browser turns a URL into a page: DNS, HTTP request, response, rendering (high level).',
        'Open Chrome DevTools and try the Elements, Console and Network tabs on any website.',
        'Install VS Code, Git and Node.js; run `git --version` and `node --version`.',
        'Create a GitHub account if you do not have one.',
      ],
      outcome: 'You can explain request -> response -> render in your own words.',
    },
    build: {
      title: 'About-me HTML page + first commit',
      steps: [
        'Create a folder `intern-portfolio` with an `index.html` file.',
        'Add a heading, a short bio, a photo or placeholder, a list of interests and 3 useful links.',
        'Open the page in a browser and fix anything that looks broken.',
        'Run `git init`, make your first commit, create a GitHub repository and push.',
      ],
      outcome: 'A valid HTML page is live in your GitHub repository.',
    },
    deliverable: 'GitHub repository URL + a screenshot of the page in your daily report.',
    resources: 'MDN: How the web works; Git basics; VS Code setup guides.',
  },
  {
    theme: 'Semantic HTML + forms',
    mission: 'Structure a real website properly and build an accessible contact form.',
    learn: {
      title: 'Semantic HTML and accessible forms',
      steps: [
        'Learn `header`, `nav`, `main`, `section`, `article`, `aside` and `footer`.',
        'Use a sensible heading order (one `h1`, then `h2`, `h3`) and meaningful link text.',
        'Learn form elements: `label`, `input`, `textarea`, `button`, plus `required`, `type` and `pattern`.',
        'Check keyboard navigation with Tab and Shift+Tab.',
      ],
      outcome: 'You can choose the right HTML element for each part of a page.',
    },
    build: {
      title: 'Multi-page site with a contact form',
      steps: [
        'Create Home, About and Contact pages with a shared navigation bar.',
        'Use semantic sections on every page and add `alt` text to all images.',
        'Build a contact form with name, email and message fields plus a submit button.',
        'Test the form with an empty field and an invalid email; use browser validation.',
      ],
      outcome: 'All three pages link correctly and the form is usable with a keyboard.',
    },
    deliverable: 'Three linked pages pushed to GitHub; screenshot of the contact form.',
    resources: 'MDN: HTML elements reference; MDN: Forms and validation.',
  },
  {
    theme: 'CSS layout with Flexbox',
    mission: 'Make the site look intentional with spacing, typography and Flexbox layouts.',
    learn: {
      title: 'CSS fundamentals and Flexbox',
      steps: [
        'Learn selectors, the box model (content, padding, border, margin), colors and contrast.',
        'Learn Flexbox: `display: flex`, `justify-content`, `align-items`, `gap`, `flex-wrap`.',
        'Study spacing and type scales; pick one font family and a small color palette.',
        'Practice on Flexbox Froggy or a similar short exercise.',
      ],
      outcome: 'You can build a row, a navigation bar and a card grid without floats.',
    },
    build: {
      title: 'Style the portfolio site',
      steps: [
        'Add a header/nav, hero section, content cards and footer to the site.',
        'Apply consistent spacing, font sizes, border radius and hover/focus states.',
        'Make links and buttons clearly look clickable and focusable.',
        'Check there is no horizontal scrolling at a normal desktop width.',
      ],
      outcome: 'The site has a clean, consistent visual style on desktop.',
    },
    deliverable: 'Desktop screenshot of the styled site in your daily report.',
    resources: 'web.dev: Learn CSS; Flexbox Froggy; MDN: CSS Box Model.',
  },
  {
    theme: 'Responsive design (mobile-first)',
    mission: 'Make the same site comfortable to use on a phone, tablet and desktop.',
    learn: {
      title: 'Responsive layout and media queries',
      steps: [
        'Add the viewport meta tag and learn why mobile-first CSS is easier to maintain.',
        'Use relative units (`rem`, `%`, `max-width`) and flexible images.',
        'Learn media queries and choose two breakpoints, for example 640px and 1024px.',
        'Test with DevTools device mode at 375px, 768px and 1440px.',
      ],
      outcome: 'You can explain why a layout breaks on mobile and fix it with CSS.',
    },
    build: {
      title: 'Responsive portfolio at three widths',
      steps: [
        'Start from the mobile layout: one column, stacked navigation, readable text.',
        'Add tablet and desktop layouts with cards in rows and comfortable spacing.',
        'Fix overflow, tiny tap targets and text that becomes too wide.',
        'Take screenshots at 375px, 768px and 1440px.',
      ],
      outcome: 'No horizontal scrolling and no unreadable text at any of the three widths.',
    },
    deliverable: 'Three screenshots (phone, tablet, desktop) in your daily report.',
    resources: 'web.dev: Responsive design; MDN: Using media queries.',
  },
  {
    theme: 'Git workflow + deploy your website',
    mission: 'Ship your portfolio to the internet and learn a clean Git workflow.',
    learn: {
      title: 'Branches, commits and static deployment',
      steps: [
        'Learn commits, branches, merging and pull requests at a basic level.',
        'Write good commit messages and learn what belongs in a README.',
        'Compare GitHub Pages, Netlify and Vercel for static sites.',
        'Learn a deployment checklist: build, test, publish, open the live URL on a phone.',
      ],
      outcome: 'You can take a local static site and publish it with a shareable URL.',
    },
    build: {
      title: 'Deploy the portfolio (Milestone 1)',
      steps: [
        'Clean up the repository and add a README with description, screenshot and live link.',
        'Deploy the site with GitHub Pages, Netlify or Vercel.',
        'Open the live URL on your phone and fix anything that breaks.',
        'Ask a teammate to review the site and note one improvement.',
      ],
      outcome: 'A live URL works on desktop and mobile.',
    },
    deliverable: 'Live website URL in your daily report and in the README.',
    resources: 'GitHub Docs: Hello World; Netlify/Vercel static site guides.',
    milestone: true,
  },
  {
    theme: 'JavaScript basics',
    mission: 'Start programming: variables, functions, arrays, objects and small interactions.',
    learn: {
      title: 'JavaScript core syntax',
      steps: [
        'Learn `let`/`const`, strings, numbers, booleans, arrays and objects.',
        'Write functions, arrow functions, `if` statements and loops.',
        'Practice `map`, `filter` and template literals on small arrays.',
        'Use `console.log` and the DevTools console to inspect values.',
      ],
      outcome: 'You can read and write simple JavaScript without copying blindly.',
    },
    build: {
      title: 'Interactive FAQ + JS exercises',
      steps: [
        'Add an FAQ section with 3 questions that open and close on click.',
        'Store the questions in an array and render the list with JavaScript.',
        'Solve 5 small exercises: sum an array, filter names, find the longest word, count vowels, reverse a string.',
        'Commit the exercises in a `js-exercises` folder.',
      ],
      outcome: 'The FAQ works and the five exercises produce correct output.',
    },
    deliverable: 'Working FAQ on the site + exercises committed to GitHub.',
    resources: 'javascript.info (first chapters); MDN: JavaScript guide.',
  },
  {
    theme: 'DOM, events and weekly review',
    mission: 'Build your first real interactive app and review your first week.',
    learn: {
      title: 'DOM, events and localStorage',
      steps: [
        'Learn `querySelector`, `createElement`, `addEventListener` and event objects.',
        'Use `preventDefault` for forms and validate input before saving.',
        'Save and load a small array with `localStorage` and `JSON.stringify`/`JSON.parse`.',
        'Learn event delegation for lists with buttons.',
      ],
      outcome: 'You can update the page from JavaScript and persist simple data.',
    },
    build: {
      title: 'Vanilla JS todo app + Week 1 review',
      steps: [
        'Build a todo app: add, complete, delete, and filter All/Active/Done.',
        'Validate the input, show an empty state and persist todos in localStorage.',
        'Write a short review: 3 things you learned, 2 blockers and 1 question for your mentor.',
        'Post the review in your daily report and ask for feedback.',
      ],
      outcome: 'Todos survive a page refresh and filters behave correctly.',
    },
    deliverable: 'Todo app link/code + week 1 review notes in your daily report.',
    resources: 'MDN: DOM, Events and localStorage.',
  },
  {
    theme: 'Async JavaScript + public APIs',
    mission: 'Fetch real data from an API and handle loading, empty and error states.',
    learn: {
      title: 'Promises, async/await and fetch',
      steps: [
        'Learn the event loop at a high level, then promises and `async`/`await`.',
        'Use `fetch`, read JSON, and check `response.ok` and HTTP status codes.',
        'Learn why API keys must not be committed and how environment variables help.',
        'Design loading, empty and error states before writing the UI.',
      ],
      outcome: 'You can fetch JSON from an API and show a useful message when it fails.',
    },
    build: {
      title: 'Weather or GitHub profile app',
      steps: [
        'Choose a free public API: weather by city or GitHub user profile.',
        'Add an input and submit button; fetch data on submit.',
        'Show loading, success, empty and error states clearly.',
        'Style the result as a responsive card and add a README with the API used.',
      ],
      outcome: 'The app handles a bad input and a network error without breaking.',
    },
    deliverable: 'Working API app + README; include the API name in your report.',
    resources: 'MDN: Fetch API; javascript.info: Promises and async/await.',
  },
  {
    theme: 'React fundamentals',
    mission: 'Move from DOM manipulation to components, props and state.',
    learn: {
      title: 'React components, props and state',
      steps: [
        'Read the React quick start: components, JSX, props and state.',
        'Learn how `useState` triggers a re-render and why state must be updated immutably.',
        'Render lists with `map` and stable `key` values.',
        'Split a screen into small components with clear responsibilities.',
      ],
      outcome: 'You can explain the difference between props and state.',
    },
    build: {
      title: 'Rebuild the todo app in React',
      steps: [
        'Create a new Next.js app called `react-todo`.',
        'Split the UI into Header, TodoForm, TodoList and TodoItem components.',
        'Manage todos with `useState`; add and complete items.',
        'Push the project to GitHub with a README.',
      ],
      outcome: 'The React todo app runs locally and is committed to GitHub.',
    },
    deliverable: 'GitHub repo + screenshot of the React todo app.',
    resources: 'react.dev/learn: Quick start and tutorial; Next.js getting started.',
  },
  {
    theme: 'React forms, effects + Milestone 2',
    mission: 'Upgrade the React app into a polished task manager and review week 2.',
    learn: {
      title: 'Controlled forms and useEffect',
      steps: [
        'Learn controlled inputs and form submission in React.',
        'Learn `useEffect`, dependency arrays and cleanup at a basic level.',
        'Lift state up when two components need the same data.',
        'Use React DevTools to inspect props and state.',
      ],
      outcome: 'You can build and debug a form that updates React state correctly.',
    },
    build: {
      title: 'Task manager with filters and persistence (Milestone 2)',
      steps: [
        'Add edit, delete and All/Active/Done filters.',
        'Persist tasks in localStorage and show counts and an empty state.',
        'Use accessible labels, keyboard-friendly buttons and clear focus styles.',
        'Deploy the app or record a 60-second demo, then write a short week 2 review.',
      ],
      outcome: 'A deployed or demo-ready task manager with no console errors.',
    },
    deliverable: 'Live URL or demo video + week 2 review in your daily report.',
    resources: 'react.dev/learn: Managing state and escape hatches.',
    milestone: true,
  },
  {
    theme: 'Next.js App Router',
    mission: 'Build a multi-page Next.js site with shared layouts and client-side navigation.',
    learn: {
      title: 'Routing, layouts and server vs client components',
      steps: [
        'Learn the App Router folder structure and `page.tsx` / `layout.tsx`.',
        'Use `Link` for navigation and add metadata for each page.',
        'Understand when a component must be a client component (`use client`).',
        'Learn how static assets and global CSS work in Next.js.',
      ],
      outcome: 'You can add a new page and shared layout without breaking navigation.',
    },
    build: {
      title: 'Next.js portfolio with shared layout',
      steps: [
        'Create pages for Home, Projects and Contact with a shared header and footer.',
        'Add responsive navigation, page metadata and a 404 page.',
        'Deploy to Vercel or Netlify and test the live URL.',
        'Add the live link to GitHub and your portfolio.',
      ],
      outcome: 'The deployed Next.js site navigates cleanly on desktop and mobile.',
    },
    deliverable: 'Deployed Next.js portfolio URL in your daily report.',
    resources: 'Next.js Learn: Routing, layouts and pages; deployment guide.',
  },
  {
    theme: 'Data fetching + API routes',
    mission: 'Load data from an API route and handle every state a user can see.',
    learn: {
      title: 'Route handlers and data fetching',
      steps: [
        'Learn REST basics: GET, POST, request body and status codes.',
        'Create a route handler in `app/api/.../route.ts` and return JSON.',
        'Learn environment variables and why server-only secrets stay on the server.',
        'Design loading, error, empty and not-found states.',
      ],
      outcome: 'You can explain the difference between a server component and an API route.',
    },
    build: {
      title: 'Projects page + contact form API',
      steps: [
        'Add a Projects page that loads data from your own API route.',
        'Handle loading, empty and error states in the UI.',
        'Build a contact form that POSTs to a route handler with server-side validation.',
        'Write a short week 3 check-in and list the top 3 bugs you fixed.',
      ],
      outcome: 'The app loads data from its own API and rejects invalid form input.',
    },
    deliverable: 'Working API route + project page + week 3 check-in.',
    resources: 'Next.js Learn: Fetching data and route handlers.',
  },
  {
    theme: 'Full-stack basics + capstone plan',
    mission: 'Understand how a database and API fit together, then design your capstone.',
    learn: {
      title: 'Databases, CRUD, auth and validation',
      steps: [
        'Learn tables, rows, primary keys, foreign keys and one-to-many relations.',
        'Learn what an ORM is and how Prisma models map to tables.',
        'Map CRUD to REST: create, read, update and delete.',
        'Learn password hashing, cookies/sessions, input validation and the OWASP top risks at a high level.',
      ],
      outcome: 'You can sketch a simple data model and its CRUD endpoints.',
    },
    build: {
      title: 'Capstone one-pager + CRUD screens',
      steps: [
        'Write a one-page capstone plan: problem, users, 3 main screens and data model.',
        'Scaffold the pages and a mock data layer (in-memory or JSON).',
        'Implement list, create and delete flows with validation and empty/error states.',
        'Ask your mentor to review the scope before you build further.',
      ],
      outcome: 'A clickable capstone skeleton with one complete CRUD flow.',
    },
    deliverable: 'Capstone one-pager + working CRUD screens in your daily report.',
    resources: 'Next.js Learn; Prisma data modeling introduction; OWASP cheat sheet.',
  },
  {
    theme: 'Capstone build day',
    mission: 'Build the core of your capstone end to end and get peer feedback.',
    learn: {
      title: 'Debugging and code review',
      steps: [
        'Use a debugging checklist: console, Network tab, React DevTools, server logs.',
        'Learn a code review checklist: naming, small components, error handling, accessibility.',
        'Control scope with must/should/could; cut anything that is not core.',
        'Read one teammate\'s code and leave two specific, kind comments.',
      ],
      outcome: 'You can find the cause of a bug instead of guessing randomly.',
    },
    build: {
      title: 'Capstone core flow',
      steps: [
        'Implement create, read, update and delete for your main entity.',
        'Add validation, loading, error and empty states, and a responsive layout.',
        'Write a README with setup steps, screenshots and the problem you solve.',
        'Fix your top 3 bugs and ask a teammate for a review.',
      ],
      outcome: 'The main user journey works from start to finish without errors.',
    },
    deliverable: 'Working capstone + README + peer review notes.',
    resources: 'Your notes from Days 1-13; mentor and peer feedback.',
  },
  {
    theme: 'Ship, demo + next steps',
    mission: 'Deploy your capstone, present it clearly and plan the next 30 days.',
    learn: {
      title: 'Deployment checklist and demo skills',
      steps: [
        'Use a deploy checklist: build locally, set environment variables, deploy, check logs.',
        'Run a smoke test on the live URL: main flow, empty state, bad input, mobile.',
        'Learn a simple demo structure: problem -> live demo -> what I learned -> next step.',
        'Plan your next 30 days of learning based on the skills you enjoyed most.',
      ],
      outcome: 'You can ship and explain a small app to a non-technical audience.',
    },
    build: {
      title: 'Deploy, demo and retro (Final milestone)',
      steps: [
        'Deploy the capstone and fix any production-only issues.',
        'Test the live app on your phone and on a teammate\'s device.',
        'Give a 5-minute demo and write a retro: wins, blockers and next 30-day plan.',
        'Add the capstone to your portfolio and pin it on GitHub.',
      ],
      outcome: 'A live capstone URL, a completed demo and a written retro.',
    },
    deliverable: 'Live capstone URL + demo + retro + updated portfolio.',
    resources: 'Vercel/Netlify deployment docs; your full plan and notes.',
    milestone: true,
  },
];

const RULES = [
  'Work in focus blocks of 25 minutes with a 5 minute break.',
  'If you are stuck for more than 20 minutes, ask in the team chat with the error message and what you tried.',
  'Commit at least once today with a clear message.',
  'Attach today\'s link or screenshot to your daily report and submit it before 6:00 PM. Check-out is blocked without a report.',
];

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function flag(name: string) {
  return process.argv.includes(`--${name}`);
}

function todayIST() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function toDate(date: string) {
  return new Date(`${date}T00:00:00.000Z`);
}

function addDays(date: string, days: number) {
  const d = toDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isWeekend(date: string) {
  const day = toDate(date).getUTCDay();
  return day === 0 || day === 6;
}

function nextWorkingDay(date: string) {
  let d = date;
  while (isWeekend(d)) d = addDays(d, 1);
  return d;
}

function workingDays(start: string, count: number) {
  const dates: string[] = [];
  let d = start;
  while (dates.length < count) {
    if (!isWeekend(d)) dates.push(d);
    d = addDays(d, 1);
  }
  return dates;
}

function prettyDate(date: string) {
  return new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(toDate(date));
}

function taskTitle(dayNo: number, kind: 'learn' | 'build', day: PlanDay) {
  const label = kind === 'learn' ? 'Learn' : 'Build';
  return `D${String(dayNo).padStart(2, '0')} ${label} · ${day[kind].title}`;
}

function taskDescription(dayNo: number, date: string, day: PlanDay, kind: 'learn' | 'build') {
  const block = day[kind];
  const heading = kind === 'learn' ? 'WHAT TO LEARN (about 2 hours)' : 'WHAT TO BUILD (about 4 hours)';
  const lines = [
    `DAY ${dayNo} OF 15 · ${prettyDate(date)}`,
    day.theme.toUpperCase(),
    '',
    day.mission,
    '',
    heading,
    ...block.steps.map((step, i) => `${i + 1}. ${step}`),
    '',
    'DONE WHEN',
    `- ${block.outcome}`,
    ...(kind === 'build' ? [`- Deliverable: ${day.deliverable}`] : []),
    '- Code is pushed to GitHub with a clear commit message.',
    '- The link or screenshot is attached to today\'s daily report.',
    '',
    'DAILY RULES',
    ...RULES.map((r) => `- ${r}`),
    '',
    `RESOURCES: ${day.resources}`,
  ];
  return lines.join('\n');
}

async function ensureDemoTeam(adminId: string, teamName: string) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('--demo is not allowed in production. Create the team and interns in the app first.');
  }
  let team = await prisma.team.findUnique({ where: { name: teamName } });
  if (!team) {
    team = await prisma.team.create({
      data: {
        name: teamName,
        description: 'Demo team for the 15-day website and web application foundations plan.',
        leadId: adminId,
        createdById: adminId,
      },
    });
    console.log(`Created demo team: ${team.name}`);
  }
  const people = [
    { email: 'priya@intern.local', displayName: 'Priya Sharma' },
    { email: 'arjun@intern.local', displayName: 'Arjun Verma' },
    { email: 'sana@intern.local', displayName: 'Sana Khan' },
  ];
  for (const person of people) {
    const existing = await prisma.user.findUnique({ where: { email: person.email } });
    if (existing) {
      if (existing.teamId !== team.id) {
        await prisma.user.update({ where: { id: existing.id }, data: { teamId: team.id, isActive: true } });
      }
      continue;
    }
    await prisma.user.create({
      data: {
        email: person.email,
        displayName: person.displayName,
        role: 'EMPLOYEE',
        teamId: team.id,
        passwordHash: await argon2.hash(DEMO_PASSWORD),
        mustChangePassword: false,
      },
    });
  }
  return team;
}

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN', isActive: true }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('No active admin found. Run `npm run seed` first.');

  const teamName = arg('team') ?? DEFAULT_TEAM;
  const demo = flag('demo');
  let team = await prisma.team.findUnique({ where: { name: teamName } });
  if (!team) {
    if (!demo) {
      throw new Error(`Team "${teamName}" not found. Create it in the app and add the interns, or run with --demo locally.`);
    }
    team = await ensureDemoTeam(admin.id, teamName);
  } else if (demo) {
    team = await ensureDemoTeam(admin.id, teamName);
  }

  let members = await prisma.user.findMany({
    where: { teamId: team.id, isActive: true, role: 'EMPLOYEE' },
    orderBy: { displayName: 'asc' },
    select: { id: true, displayName: true, email: true },
  });
  if (members.length === 0) {
    throw new Error(`Team "${team.name}" has no active employees. Add the interns to the team first.`);
  }

  const requestedStart = arg('start');
  let startDate: string;
  if (requestedStart) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedStart) || Number.isNaN(toDate(requestedStart).getTime())) {
      throw new Error('--start must be a valid date in YYYY-MM-DD format.');
    }
    startDate = nextWorkingDay(requestedStart);
    if (startDate !== requestedStart) console.log(`Start date moved from ${requestedStart} to ${startDate} (weekend).`);
  } else {
    startDate = nextWorkingDay(addDays(todayIST(), 1));
  }
  const dates = workingDays(startDate, PLAN.length);
  const endDate = dates[dates.length - 1];

  let project = await prisma.project.findFirst({ where: { name: PROJECT_NAME, teamId: team.id } });
  if (!project) {
    project = await prisma.project.create({
      data: {
        name: PROJECT_NAME,
        description:
          'A guided 15-working-day sprint for fresh interns: HTML, CSS, JavaScript, React, Next.js and a deployed capstone. ' +
          'Saturday and Sunday are holidays. Each working day has one Learn task and one Build task. ' +
          'Submit the daily report before logging out.',
        status: 'ACTIVE',
        teamId: team.id,
        ownerId: admin.id,
        startDate: toDate(startDate),
        dueDate: toDate(endDate),
        createdById: admin.id,
      },
    });
    console.log(`Created project: ${project.name}`);
  } else {
    await prisma.project.update({
      where: { id: project.id },
      data: { ownerId: admin.id, startDate: toDate(startDate), dueDate: toDate(endDate) },
    });
  }

  if (flag('reset')) {
    const removed = await prisma.task.deleteMany({ where: { projectId: project.id } });
    console.log(`Removed ${removed.count} existing plan tasks.`);
  }

  const goalSpecs = [
    { title: 'Week 1 · Personal website live', description: 'Ship a responsive personal website with HTML, CSS, Git and deployment.' },
    { title: 'Week 2 · Interactive React task manager', description: 'Learn JavaScript and React, then ship a persistent task manager.' },
    { title: 'Week 3 · Full-stack capstone shipped', description: 'Design, build, deploy and demo a small full-stack web application.' },
  ];
  const goals = [];
  for (let i = 0; i < goalSpecs.length; i++) {
    const spec = goalSpecs[i];
    let goal = await prisma.goal.findFirst({ where: { teamId: team.id, title: spec.title } });
    if (!goal) {
      goal = await prisma.goal.create({
        data: {
          title: spec.title,
          description: spec.description,
          type: 'WEEKLY',
          status: 'ACTIVE',
          teamId: team.id,
          startDate: toDate(dates[i * 5]),
          endDate: toDate(dates[i * 5 + 4]),
          createdById: admin.id,
        },
      });
    } else {
      await prisma.goal.update({
        where: { id: goal.id },
        data: { startDate: toDate(dates[i * 5]), endDate: toDate(dates[i * 5 + 4]) },
      });
    }
    goals.push(goal);
  }

  const existing = new Set(
    (await prisma.task.findMany({ where: { projectId: project.id }, select: { ownerId: true, title: true } })).map(
      (t) => `${t.ownerId}|${t.title}`,
    ),
  );

  let created = 0;
  let skipped = 0;
  for (let i = 0; i < PLAN.length; i++) {
    const day = PLAN[i];
    const date = dates[i];
    const goal = goals[Math.floor(i / 5)];
    for (const member of members) {
      for (const kind of ['learn', 'build'] as const) {
        const title = taskTitle(i + 1, kind, day);
        const key = `${member.id}|${title}`;
        if (!flag('reset') && existing.has(key)) {
          skipped++;
          continue;
        }
        await prisma.task.create({
          data: {
            title,
            description: taskDescription(i + 1, date, day, kind),
            ownerId: member.id,
            teamId: team.id,
            projectId: project.id,
            goalId: goal.id,
            createdById: admin.id,
            priority: day.milestone && kind === 'build' ? 'HIGH' : 'MEDIUM',
            dueDate: new Date(`${date}T${kind === 'learn' ? '13:00' : '18:00'}:00+05:30`),
            estimatedHours: kind === 'learn' ? 2 : 4,
          },
        });
        created++;
      }
    }
  }

  const notificationTitle = 'Your 15-day web foundations plan is ready';
  for (const member of members) {
    const exists = await prisma.notification.findFirst({ where: { userId: member.id, title: notificationTitle } });
    if (exists) continue;
    await prisma.notification.create({
      data: {
        userId: member.id,
        type: 'ANNOUNCEMENT',
        title: notificationTitle,
        body: `Learn and build something every working day from ${startDate} to ${endDate}. Saturdays and Sundays are holidays. Open the project to see today's two tasks.`,
        link: `/projects/${project.id}`,
      },
    });
  }

  console.log('');
  console.log(`Team: ${team.name} (${members.length} interns: ${members.map((m) => m.displayName).join(', ')})`);
  console.log(`Project: ${PROJECT_NAME}`);
  console.log(`Schedule: ${startDate} -> ${endDate} · ${dates.length} working days · weekends are holidays`);
  console.log(`Tasks created: ${created}, already present: ${skipped}`);
  console.log(`Goals: ${goalSpecs.map((g) => g.title).join(' | ')}`);
  if (demo) console.log(`Demo logins: ${members.map((m) => m.email).join(', ')} · password ${DEMO_PASSWORD}`);
  console.log('');
  for (let i = 0; i < dates.length; i++) {
    console.log(`${dates[i]} ${prettyDate(dates[i]).padEnd(13)} Day ${String(i + 1).padStart(2, '0')} · ${PLAN[i].theme}`);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
