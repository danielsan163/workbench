# Workbench

A no-install iPhone web app (PWA) for tracking in-progress projects. It shows the next step for each project, the tools and materials you still need, and how long until each deadline.

## Features
- **Next step first.** Every project card shows its next step, with a one-tap ✓ to finish it right from the list.
- **Steps.** You can reorder them, use "Do later" to push one to the end, and look back at completed steps.
- **Tools & materials.** Each item can have a quantity, cost, and store. Typing "3x hinges" saves the quantity as 3.
- **Shopping tab.** Collects everything you still need across all open projects. You can group it by project, store, or type, check items off in the store, and share the list to Notes or Messages.
- **Deadlines.** Countdown badges and an Upcoming tab. You can export deadlines to the iPhone Calendar as `.ics` with a reminder the morning before.
- **Statuses.** Active, Waiting (with a "waiting on…" note), Paused, and Done. Projects you haven't touched in a while get an idle flag.
- **Work log.** Optional hours per entry. Completed steps and status changes are logged automatically.
- **Photos.** Progress photos are compressed on the device, and you can pick a cover photo that shows on the card.
- **Notes, search, filters, sorting**, plus dark mode, undo, and app-icon badge (optional).
- **Backup and restore.** Exports a JSON file (photos optional) through the iOS share sheet so you can save it to Files or iCloud Drive.

## Data
Everything stays on the device: projects in `localStorage`, photos in IndexedDB. Nothing is uploaded. **Add it to your Home Screen.** iOS can clear website data that hasn't been used in a while, but it doesn't do that for installed web apps. Export a backup now and then.

## Install on iPhone
1. Open the GitHub Pages URL in **Safari**.
2. Tap **Share**, then **Add to Home Screen**.

## Develop
It's plain HTML, CSS, and JS with no build step. Serve the folder locally:

```
python -m http.server 8766
```

Pushing to `main` deploys through GitHub Pages. The service worker loads files from the network first, so the phone picks up changes on the next launch while online. Bump `VERSION` in `sw.js` when you add new files to `ASSETS`.
