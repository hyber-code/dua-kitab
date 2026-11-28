# Dua Kitab

An offline-capable web app of the Complete Dua Book (Kitab ud Dua).

Open the link on a phone and add it to the home screen:

- **iPhone:** Share, then "Add to Home Screen".
- **Android:** menu, then "Install app".

Features: tappable contents, section index, bookmarks, simple highlighting,
remembers the last page, scroll or page-by-page reading, dark mode, works offline.
Bookmarks and highlights stay on the reader's own phone. No accounts, no adverts, no tracking.

## Publishing a revised edition

1. Run `tools/build.py NEW.pdf NEW.docx <this folder> <edition number>` (needs `poppler-utils` and Python `pillow`).
2. If page numbers moved, fill in `migrations` in `data.json` so bookmarks follow.
3. Run `tools/test_app.py <url>` against a local copy, then commit and push.
