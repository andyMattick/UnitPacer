# Unit Pacer

A unit & lesson planner for any teacher. Import your school calendar, describe your
class schedule, enter the classes you teach, and plan units that pace themselves
around breaks, holidays, and snow days.

Forked from the `mergedCalendars` planner with the school-specific backbone removed.
Everything runs in the browser; data stays in the teacher's own browser (localStorage).

## First run

The **School setup** wizard opens automatically:

1. **School year** — school name, first/last day, periods per day
2. **School calendar** — upload a `.ics` (Google Calendar / Outlook export or a school
   feed) or `.csv`, then review each event as *No school*, *Event*, or *Ignore*.
   Add or edit events by hand. A CSV template is downloadable from this step
   (see also `sample-school-calendar.csv`).
3. **Class schedule** — rotating letter days (A–G or any letters), same every day,
   A/B block, or weekday-based (M/T/W/R/F), plus a period map of which periods meet
   on each day type. Rotation letters only advance on school days.
4. **Your classes** — what you teach each period (blank = planning period)
5. **Review** — creates the calendar

Afterwards, the **🏫 School Setup** card at the top of the sidebar lets you
*Update school calendar* (re-import or edit events), *Edit setup*, or start a
*New school year*. Updating keeps units, notes, and assessments; units re-flow onto
the new class days.

## Files

| File | What it is |
|---|---|
| `index.html` | The planner (forked from mergedCalendars, school data removed) |
| `setup-wizard.js` / `.css` | School setup wizard, calendar import, sidebar card |
| `sample-school-calendar.csv` | Example CSV import |

## Changes from mergedCalendars

- Removed built-in HS/MS/LS rotation data, special days, bell times, period overrides
- Division and semester selectors hidden; one calendar covers the whole year
- Every calendar is a "custom calendar pack" built by the wizard
- Pack-level no-school days show **NO SCHOOL + label** in month/week/day views
- Single-day-type schedules ("Same every day") hide the day letter on the calendar
- **All localStorage keys are prefixed `unitpacer:`** so this app never reads or
  overwrites mergedCalendars data when both are hosted under the same
  `username.github.io` origin

## Hosting

GitHub Pages: Settings → Pages → Deploy from branch → `main` / root.

## Not included yet

- Unit Builder / Content Studio / Tracker (the "Send to Unit Builder" button
  expects a `unit-builder/` folder — copy it over if you want that flow)
