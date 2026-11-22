# Family Map

An interactive map of the places, photos and stories of the White and Karman family ancestors.

- **Map:** photo thumbnails, story pins (📖) and life-event dots. Click a photo or story pin to open its story.
- **Sidebar:** the family tree for both sides. Pick a person to filter the map to their life events (numbered in order, joined by a dashed line), photos and stories.
- **Links:** `#person=<id>` and `#story=<id>` in the URL open a person or story directly.

## Privacy
Living people appear only as "Living [Surname]", with no dates, places or photos. Stories come from the *family copy* of the stories documents, with living people's birth dates removed.

## Keeping the site up to date

The site is rebuilt from the family tree project's shared folder (`/mnt/project-files`) whenever the stories or the tree change. In a Claude session in that project, ask: **"update the family map site"**. The steps are:

1. **Export the stories docs to Markdown** and save them over:
   - `family-map-site/sources/white-stories-family-copy.md` from **"Our Family Stories (family copy)"** (never the full version)
   - `family-map-site/sources/karman-stories.md` from **"Karman Family Stories"**
2. **Re-export the trees** from MyHeritage if they changed. The build uses the newest `family-tree-audit/working-tree/white-family-tree-*.ged` and `family-tree-audit/karman-side/karman-family-tree-*.ged`.
3. **Run** `python3 tools/build.py` (Python 3 with `markdown` and `Pillow`). It writes `data/family.json` and `img/`, plus a report at `family-map-site/last-build-report.md`.
4. **Read the report.** It lists new stories it linked automatically (check the people and add map pins in `tools/stories.json`), photos in `documents/photos/` not yet on the site (add them to `tools/photos.json`, or to the private skip list), and places it couldn't map (add them to `tools/place_overrides.json`).
5. **Commit and push.** GitHub Pages republishes in about a minute. Bump the `?v=` number on `app.js` in `index.html` if the app code changed.

### Privacy rules
The privacy rules live in the project folder at `family-map-site/private/privacy.json`, **not in this public repo**, because they name what must stay private. They treat anyone with no death record born in 1915 or later as living (no name, dates, places or photos), publish only `###` story sections minus an exclusion list, scrub living people's details from story text, skip private photos, and **stop the build** if a story contains a forbidden term or a living person's full name.

## Files
- `index.html`, `style.css`, `app.js`: the app (Leaflet + MarkerCluster, bundled in `vendor/`, no build step).
- `data/family.json`: people, events with map coordinates, stories and photo index.
- `img/`: photos (full size and thumbnails).
- `tools/build.py`: rebuilds `data/family.json` and `img/`. `tools/stories.json` and `tools/photos.json` say which people and places each story and photo belong to; `tools/place_overrides.json` fixes map positions.

Map tiles © OpenStreetMap contributors.
