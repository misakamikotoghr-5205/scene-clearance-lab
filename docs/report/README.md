# Aholo report inputs and local reproduction

The five-page Chinese report documents one actual Lux3D generation/download/import and one same-parameter A/B browser run. It has been uploaded to the event form; the final project entry has not been submitted. No raw GLB, uncropped account screenshot or credential is included.

Inputs are `../aholo-report.md`, `../evidence/lux3d-import-20261110.json`, `../evidence/placement-report-20261110.json` and `images/*.png`. The actual layout report is 22,884 bytes, SHA-256 `85fec1fe322a1acc46b9e9dd866fad498d65a623d617f73d89e205ba278e12c2`. All source-verification flags remain false; model geometry is excluded.

From the project root, with Python 3, ReportLab, Pillow and the WQY Zen Hei font installed:

```sh
python3 docs/report/render_report.py \
  --layout-report docs/evidence/placement-report-20261110.json \
  --image-dir docs/report/images \
  --out docs/report/scene-clearance-aholo-report.pdf
```

These are document-build dependencies, not application runtime dependencies. The script makes no network requests. It checks the downloaded report fingerprint, both actual snapshots and placed asset, comparable settings and summary deltas; missing images and page overflow fail the build. PDF metadata timestamps may vary between builds; the underlying layout report hash binds the original data.

After document changes, render every PDF page to PNG with Poppler and visually inspect paragraphs, tables, screenshots, glyphs and footers. The delivered artifact was inspected this way on all five pages.

The images are rectangular crops of actual browser screenshots with Chrome tabs, account nicknames and task identifiers removed. The reference image crop does not present the earlier default 300K/PBR controls as final settings. Captions retain the black platform-viewer observation and interactive 2D fallback. The change from four to two warnings is not a safety certification; one overlap and one zone warning remain.

One generated asset does not inherit the code's MIT license. Its raw bytes remain private because commercial/redistribution permission has not been verified. The PDF contains no model attachment. Screenshots and report are AI-labelled, noncommercial contest demonstration materials. See the [official submission instructions](https://www.aholo3d.cn/hackathon/submission) for complete-report, real-operation-video and exhibition/archival permission conditions; this README does not accept terms on the user's behalf.
