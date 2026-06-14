# SplitWise — Shared Expenses App

A full-stack shared expense tracker built for four flatmates (Aisha, Rohan, Priya, Meera) with support for changing membership over time, multi-currency expenses, and intelligent CSV import with anomaly detection.

## Live Demo

- **Frontend:** [https://spreetail-assignment-eosin.vercel.app/](https://spreetail-assignment-eosin.vercel.app/) 

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vite + React 18 + TypeScript |
| Backend | Express.js + Node.js + TypeScript |
| Database | PostgreSQL (Render managed) |
| ORM | Drizzle ORM |
| Auth | JWT + bcrypt |
| CSV Parser | PapaParse |
| Deployment | Render (backend + DB) + Vercel (frontend) |

## Local Setup

### Prerequisites
- Node.js 18+
- PostgreSQL (local or Render free tier)

### 1. Clone the repository
```bash
git clone https://github.com/yourusername/splitwise-lpu.git
cd splitwise-lpu
```

### 2. Backend setup
```bash
cd backend
cp .env.example .env
# Edit .env — set DATABASE_URL and JWT_SECRET
npm install
npm run db:generate
npm run db:migrate
npm run dev
```

### 3. Frontend setup
```bash
cd frontend
cp .env.example .env
# Edit .env — set VITE_API_URL=http://localhost:3001
npm install
npm run dev
```

### 4. Open the app
- Frontend: http://localhost:5173
- Backend API: http://localhost:3001/health

## Environment Variables

### Backend (`backend/.env`)
```
DATABASE_URL=postgresql://user:password@host:5432/dbname
JWT_SECRET=your-random-secret-key
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:5173
```

### Frontend (`frontend/.env`)
```
VITE_API_URL=http://localhost:3001
```

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/login` | Login, get JWT |
| GET | `/api/groups` | List user's groups |
| POST | `/api/groups` | Create group |
| GET | `/api/groups/:id` | Group detail + members |
| POST | `/api/groups/:id/members` | Add member with join date |
| PATCH | `/api/groups/:id/members/:uid/leave` | Mark member as left |
| GET | `/api/groups/:id/expenses` | List expenses |
| POST | `/api/groups/:id/expenses` | Create expense |
| GET | `/api/groups/:id/expenses/:eid` | Expense detail with participants |
| GET | `/api/groups/:id/balances` | Net balances + settle-up transactions |
| GET | `/api/groups/:id/balances/:uid/breakdown` | Expense drill-down for one user |
| POST | `/api/groups/:id/settlements` | Record settlement |
| POST | `/api/groups/:id/import/parse` | Parse CSV, get anomaly report |
| GET | `/api/groups/:id/import/:sid` | Get import session |
| PATCH | `/api/groups/:id/import/:sid/anomalies/:aid` | Approve/reject anomaly |
| POST | `/api/groups/:id/import/:sid/commit` | Finalize import |
| GET | `/api/groups/:id/import/:sid/report` | Download import report |

## AI Tool Used

**Primary tool:** Antigravity IDE (Google DeepMind AI coding assistant)

See [AI_USAGE.md](./AI_USAGE.md) for detailed usage log, key prompts, and corrections made.

## Project Structure

```
splitwise-lpu/
├── backend/
│   ├── src/
│   │   ├── db/            # Drizzle schema + migrations
│   │   ├── middleware/    # JWT auth
│   │   ├── routes/        # API routes
│   │   └── services/      # Business logic (balance, split, importer)
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/    # Tab components + sidebar
│   │   ├── contexts/      # Auth context
│   │   ├── lib/           # API client + utils
│   │   └── pages/         # Login, Groups, Group
│   └── package.json
├── SCOPE.md
├── DECISIONS.md
├── AI_USAGE.md
└── README.md
```

## Deployment (Render + Vercel)

### Backend on Render
1. Create a new Web Service on Render
2. Connect your GitHub repo
3. Build command: `cd backend && npm install && npm run build`
4. Start command: `node backend/dist/index.js`
5. Add environment variables
6. Create a Render PostgreSQL database and link the `DATABASE_URL`

### Frontend on Vercel
1. Connect your GitHub repo to Vercel
2. Set Root Directory to `frontend`
3. Add `VITE_API_URL=https://your-backend.onrender.com`
4. Deploy
