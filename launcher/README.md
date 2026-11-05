# Local testing and public preview

`Start Public.ps1` starts the website, backend, bot and temporary public tunnel. It uses the optimized production build when one is prepared, avoiding compilation during a visitor's first page visit.

After editing frontend files, run these from the project root:

```powershell
& '.\launcher\Build Web.ps1'
& '.\launcher\Start Public.ps1'
```

The second command automatically switches the frontend to the newly completed build. It preserves the running database and Telegram bot. A failed build does not stop the current web server. Build output alternates between ignored `.next-share-a` and `.next-share-b` directories, so a build does not overwrite files served by the active version, and the API rewrite points to the local backend on port 18001.

For interactive coding with hot reload, use `npm run dev -- --hostname 0.0.0.0 --port 13002` from `frontend` in a separate terminal, with `BACKEND_INTERNAL_URL=http://127.0.0.1:18001`. Rebuild the public preview after the change is verified.

Public tunnel links are temporary and the computer must remain on and online. Use a hosted deployment for a permanent address and independent uptime.
