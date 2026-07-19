# RehabMate · 復健幫手

A tiny, self-contained **3D body pain-mapping tool** for rehab / physiotherapy clinics.
A patient rotates an anatomical body, places color-coded pins exactly where it hurts, and selects a pain type for each pin — so "it hurts *here*" becomes a shared, precise picture instead of a vague gesture.

**Live demo:** https://rehab-body-map.vercel.app

![RehabMate](docs/preview.png)

[▶ Watch a 16s demo](docs/rehabmate-demo.mp4) — rotate, tap muscles to mark pain, front/back views.

---

## What it does

- **Rotate a real muscular 3D body** — drag to orbit, pinch/scroll to zoom, one-tap front / back / left / right views.
- **Tap anywhere on the body → place a pin.** Up to 20 simultaneous pins each receive a unique color.
- **Eight pain types** — sharp pain, soreness, tenderness, dull aching, and four movement-related pain options can be changed after selecting a pin.
- **~40 named muscle groups**, used to label each exact pin location.
- **Live summary panel** for selecting, editing, and deleting individual pins.
- **Works on phones.** Collapsible summary sheet keeps the body fully visible; touch-tuned controls.
- **No build and no backend.** Static HTML and JavaScript load directly in the browser.

## Why it exists

In a rehab consult the patient often can't name the muscle, and pointing at their own body across a desk is imprecise. RehabMate gives both people the same rotatable model to point at, and turns the pointing into a written record.

## Run it

Any static file server works — there is no build step.

```bash
# clone, then from the repo root:
python3 -m http.server 8000
# open http://localhost:8000
```

Or drop the folder onto any static host (Vercel, Netlify, GitHub Pages, an intranet box).

## How it works (for anyone extending it)

- **Rendering:** [three.js](https://threejs.org) (loaded from a CDN via import-map). One `<script type="module">` in `index.html`, no bundler.
- **Editing pain types:** update the single `PAIN_TYPE_CONFIG` definition in `app.js`; the right-side buttons are generated from it.
- **Muscle regions:** the body is a single mesh. On load, every vertex is assigned to its nearest anatomical zone (see the `MUSCLES` array in `muscles.js`). A raycast places each pin at the exact surface hit and uses that zone for its label.
- **Editing the muscle map:** each entry in `MUSCLES` is `[name, side, x, y, z, rx, ry, rz]` — a labelled zone centre plus per-axis reach. Move a centre or widen a radius and that region's coverage changes. Front zones use `z > 0`, back zones `z < 0`, which keeps front/back muscles independent.
- **Swapping the model:** replace `assets/body.glb` with any single-mesh humanoid GLB and re-check the `MUSCLES` coordinates against its proportions.

## Credits & licence

- **Code:** MIT © 2026 — see [LICENSE](LICENSE).
- **3D model:** *"Male base muscular anatomy"* by **[CharacterZone](https://sketchfab.com/CharacterZone)**, licensed **[CC BY 4.0](http://creativecommons.org/licenses/by/4.0/)** via Sketchfab. The model file (`assets/body.glb`) is redistributed here under that licence with attribution — see [ATTRIBUTION.md](ATTRIBUTION.md).

Not a medical device. It records where a patient says it hurts; it does not diagnose.
