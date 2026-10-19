# Project context for Claude

## About me
- Musee, Computer Engineering graduate (Embedded Systems, Jönköping University, 2026)
- Strong in C (bare-metal STM32, FreeRTOS), Python, ROS 2, VHDL
- New to web development, backend, databases and cloud
- Goal: build projects that make my CV more IT-oriented

## How to work with me
- Explain what you do and why, step by step. I want to learn, not just get code.
- Keep changes small, one feature at a time, and tell me how to test each one.
- Point out the concepts worth mentioning in a job interview.
- Write clear commit messages and keep the README up to date.
- After each step that works, make a small commit with a clear message (for example: “Add booking data model and migrations”). Commit as me, never add Co-Authored-By lines.
- The booking system must prevent double bookings: two customers can never book the same barber at overlapping times. Enforce it both in the API and in the database, and explain how it works.

## Project plan (no hardware needed)
1. **CI/CD on my STM32 repos** – GitHub Actions that builds with arm-none-eabi-gcc on every push, plus a build badge in the README.
2. **Booking system (main project)** – a self-built alternative to Setmore for barbershops:
   - Backend: Python (FastAPI) + PostgreSQL
   - Features: services, time slots, booking/cancellation, admin login for the barber
   - Frontend: React
   - Deploy for free (Render/Vercel) with a live demo link
3. **Warehouse tool** – pick lists / barcode scanning / statistics, using made-up data only.
4. **Certificate in parallel** – AZ-900 or AWS Cloud Practitioner.

## GitHub
github.com/musee-00
- Commit as me. Never add Co-Authored-By lines to commits.
