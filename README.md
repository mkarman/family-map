# Family Map

An interactive map of the places, photos and stories of the White and Karman family ancestors.

- **Map:** photo thumbnails, story pins (📖) and life-event dots. Click a photo or story pin to open its story.
- **Sidebar:** the family tree for both sides. Pick a person to filter the map to their life events (numbered in order, joined by a dashed line), photos and stories.
- **Links:** `#person=<id>` and `#story=<id>` in the URL open a person or story directly.

## Privacy
Living people appear only as "Living [Surname]", with no dates, places or photos. Stories come from the *family copy* of the stories documents, with living people's birth dates removed.

## Files
- `index.html`, `style.css`, `app.js`: the app (Leaflet + MarkerCluster, bundled in `vendor/`, no build step).
- `data/family.json`: people, events with map coordinates, stories and photo index.
- `img/`: photos (full size and thumbnails).
- `tools/`: the Python scripts that build `data/family.json` and `img/` from the MyHeritage GEDCOM exports, the stories docs and the project photo folders. `story_config.py` and `photo_config.py` say which people and places each story and photo belong to; `place_overrides.json` fixes map positions.

Map tiles © OpenStreetMap contributors © CARTO.
