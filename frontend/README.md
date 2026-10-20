# Booking System – Frontend

React + Vite app for the barber booking system. For the project overview, see the [main README](../README.md).

## Run

```bash
npm install
npm run dev       # http://localhost:5173 (expects the API on http://localhost:8000)
npm run build     # production build in dist/
npm run lint      # oxlint
```

## Pages

| Route | File | Purpose |
|---|---|---|
| `/` | `src/pages/CustomerPage.jsx` | Public landing page and five-step booking wizard |
| `/admin` | `src/pages/AdminLoginPage.jsx` | Admin login; shows "session expired" when redirected after a `401` |
| `/admin/appointments` | `src/pages/AdminAppointmentsPage.jsx` | Week and day calendar: create, view and cancel bookings |
| `/admin/team` | `src/pages/AdminTeamPage.jsx` | Add, edit, deactivate and reactivate barbers and services |

`src/components/ProtectedRoute.jsx` redirects to `/admin` when no token is stored. The token itself is checked by the API. All admin requests go through the `useAdminFetch()` hook in `src/api.js`, which sends the token and handles an expired session.

## Notes

- The API address comes from `VITE_API_URL` (see `.env.example`), read once in `src/api.js`. Vite bakes it into the build, so it must be set **before** building (for example in Vercel's environment variables).
- Dates for the API are built from **local** date parts, not `toISOString()`, which converts to UTC and shifts the day in timezones ahead of UTC.
