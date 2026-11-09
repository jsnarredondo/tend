# Tend

Family care tracker: meds, temperatures, symptoms, records, reminders, and Tell Tend (just say what happened).

- `docs/` is the live site, served by GitHub Pages.
- `src/cloud.js` connects the app to Supabase (logins, shared live data, Tell Tend).
- `supabase/functions/tend` is the server function. It holds the Anthropic API key as a Supabase secret, never in this repo.
- `build.py` builds `docs/` from the Tend app source.

No health data is stored in this repo. All data lives in Supabase behind login.
