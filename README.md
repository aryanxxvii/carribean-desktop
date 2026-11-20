# Carribean

Carribean is a Windows film library for movies on your hard drive. It keeps a portable catalog and watchlists, includes the 56 recommendations from Afterlight, and opens local movies in your Windows video player. The Library includes browsable shelves, poster and list views, and filters for genre, runtime, and watch status, with sorting and grouping.

## Windows

From this checkout, open `release/Carribean-Setup-1.0.0.exe` to install the app. The installer is an unsigned x64 build. In **Settings → Library**, select your movie folder. Carribean scans subfolders on launch, checks for drive changes while running, and retains the catalog when the drive disconnects.

Carribean imports an existing installation from `%APPDATA%\theatre\theatre-data` on first launch. If you have the original repository instead, use **Import from the original app** and select its `backend` folder. The preview and the desktop app use the same collection at `%LOCALAPPDATA%\Carribean\Collection`.

## Git backup and restore

1. Install Git for Windows with Git Credential Manager. Create or choose a private Git repository.
2. In **Settings → Git sync**, enter its HTTPS URL, your Git author name and email, and a backup branch. The default branch is `carribean-library`.
3. Choose **Sign in to Git** to authenticate through Git Credential Manager, then choose **Sync now**. The toolbar’s **Sync library** button refreshes the movie folder and syncs the configured Git branch. **Sync with Git on startup** is enabled by default after configuration.
4. On another laptop, enter the same repository and branch, sign in, and sync. Point Carribean at the movie folder on that laptop to reconnect playback.

Carribean commits one `carribean-library.json` snapshot on the selected branch. It merges watchlists, membership, watched status, and film metadata across devices. Video files, absolute paths, and authentication credentials stay local. JSON export and import are also available in Library settings.

## Live development

```powershell
npm ci
npm run dev
```

Open [the live localhost preview](http://127.0.0.1:4317/). Source changes reload the preview. Run `npm run desktop` to open Electron, `npm run dist:win` to build the installer, and `npm test` to run the filename and Git recovery tests.

Discover, watchlists, and the metadata editor can search for a title online. Carribean uses OMDb when a key is configured and Wikipedia and Wikidata otherwise. Add an OMDb key in **Settings → Metadata** for automatic poster and film lookup for new files.

The original library data and OMDb poster cache come from Carribean. The recommendation catalog and its posters come from Afterlight. [Carribean](https://github.com/aryanxxvii/carribean) · [Afterlight](https://afterlight-watchlist.aryanwdn.chatgpt.site/)

Spotlight art comes from TMDB and the film or festival sources below. [Arrival](https://www.moma.org/calendar/events/2555) · [White Sun](https://trigon-film.org/en/films/white-sun/) · [A Road to a Village](https://www.biff.kr/eng/html/archive/arc_history_view.asp?kind=history&m_idx=68649&pyear=2023) · [Kagbeni](https://www.thefilmnepal.com/movie/kagbeni) · [Pashupati Prasad](https://www.youtube.com/watch?v=CIMUupnpo5Y)

The bundled Geist webfont is available under the SIL Open Font License in `public/fonts/Geist-OFL.txt`. [Geist](https://vercel.com/font)
