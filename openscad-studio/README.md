# OpenSCAD Studio

A browser-based OpenSCAD editor, compiler, and 3D viewer. Design parametric 3D-printable objects from any device — phone, tablet, or desktop — with no local OpenSCAD installation required.

**Frontend** → GitHub Pages (static HTML / CSS / Vanilla JS)  
**Backend**  → Render (Docker · Node.js · OpenSCAD)

---

## Features

| Feature | Details |
|---|---|
| Code editor | CodeMirror 5 with C-like syntax highlighting, line numbers, code folding, bracket matching |
| Compile to STL | POST to Render backend → binary STL returned |
| 3D preview | Three.js viewer with orbit/pan/zoom, grid, axes, bounding box, wireframe |
| Measurements | Live W × D × H dimensions, triangle count, file size, compile time |
| File I/O | Open/save `.scad`, download `.stl`, drag-and-drop |
| Templates | 10 board-game component templates (dice tray, tower, deck box, etc.) |
| Themes | Dark and light modes (persisted to `localStorage`) |
| Mobile | Responsive layout — portrait stacks editor/viewer, landscape splits side-by-side |
| AI API | `window.openscadStudio` — LLM-callable functions to read/edit/compile code |
| Autosave | Code auto-saved to `localStorage` every 1.2 s |

---

## Repository Structure

```
openscad-studio/
├── index.html          ← Main page (served by GitHub Pages)
├── style.css           ← All styles (dark + light themes)
├── app.js              ← Application logic (ES module)
├── README.md
└── api/
    ├── server.js       ← Express API
    ├── package.json
    └── Dockerfile      ← Deploy to Render
```

---

## Deploy the Backend (Render)

### 1 — Push to GitHub

```bash
git add .
git commit -m "initial commit"
git push origin main
```

### 2 — Create a Render Web Service

1. Go to [render.com](https://render.com) → **New → Web Service**
2. Connect your GitHub repository
3. Set the following in the Render dashboard:

| Setting | Value |
|---|---|
| **Runtime** | Docker |
| **Dockerfile path** | `api/Dockerfile` |
| **Root directory** | *(leave blank)* |
| **Plan** | Free (or Starter for always-on) |

4. Click **Deploy**. Render will build the Docker image and start the service.
5. Copy the service URL — it looks like `https://your-app-name.onrender.com`

> **Free tier note:** Render free services spin down after 15 minutes of inactivity and take ~30 s to cold-start. Upgrade to a paid plan for always-on behaviour.

---

## Deploy the Frontend (GitHub Pages)

1. In your repository on GitHub, go to **Settings → Pages**
2. Set **Source** to `Deploy from a branch`
3. Branch: `main`, Folder: `/ (root)`
4. Click **Save**

Your app will be live at `https://your-username.github.io/openscad-studio/`

### Configure the API URL

On first load the app will show a banner prompting you to configure the backend URL:

1. Click **Settings** in the toolbar
2. Paste your Render URL (e.g. `https://your-app-name.onrender.com`)
3. Click **Save**

The URL is stored in `localStorage` — you only need to do this once per browser.

---

## Local Development

### Frontend

The frontend is pure HTML/CSS/JS — just open `index.html` in a browser.

```bash
# Any static server works, e.g.:
npx serve .
# or
python -m http.server 8080
```

Then set the API URL in Settings to your local backend (`http://localhost:3000`).

### Backend

Requirements: **Node.js ≥ 18** and **OpenSCAD** installed locally.

```bash
cd api
npm install
USE_XVFB=false node server.js
```

Set `USE_XVFB=false` when running locally on macOS or Windows (Xvfb is Linux-only).

#### Test the compile endpoint

```bash
curl -X POST http://localhost:3000/compile \
     -H "Content-Type: application/json" \
     -d '{"code": "sphere(r=20); "}' \
     --output test.stl

# Check it compiled:
ls -lh test.stl
```

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `F5` / `Ctrl+Enter` | Compile STL |
| `Ctrl+S` | Save `.scad` |
| `Ctrl+O` | Open file |
| `Ctrl+N` | New file |
| `Ctrl+D` | Download STL |
| `Ctrl+/` | Toggle comment |
| `R` | Reset camera (when not in editor) |
| `W` | Toggle wireframe |
| `B` | Toggle bounding box |

---

## AI / LLM Integration

The app exposes `window.openscadStudio` so an LLM agent can programmatically read and edit code:

```javascript
// Read current code
const code = window.openscadStudio.getCode();

// Replace a value
window.openscadStudio.replaceInCode(/wall\s*=\s*[\d.]+/, 'wall = 4');

// Compile
await window.openscadStudio.compile();

// Get model dimensions
const dims = window.openscadStudio.getBoundingBox();
// → { width: 120.0, depth: 80.0, height: 25.0 }

// Load a template
window.openscadStudio.loadTemplate('dice-tower');

// List available templates
window.openscadStudio.getTemplates();
```

---

## Board Game Templates

| Template key | Description |
|---|---|
| `dice-tray` | Parametric rounded tray with ventilation pattern |
| `dice-tower` | Tower with interior baffles |
| `deck-box` | Box sized for sleeved cards |
| `card-tray` | Multi-slot card organiser |
| `token-tray` | Cylindrical stacking columns |
| `insert-box` | Divided insert with configurable grid |
| `card-divider` | Tab divider with left/centre/right tab position |
| `tile-holder` | Stack channel with side access slot |
| `parametric-box` | General rounded or square box |
| `snap-lid` | Box + snap-fit lid (prints as two parts) |

---

## Future Endpoints (stubbed in server.js)

| Endpoint | Purpose |
|---|---|
| `POST /render-png` | Render a PNG preview image |
| `POST /analyze` | Return geometry statistics |
| `POST /slice` | Run a slicer (e.g. PrusaSlicer CLI) |
| `POST /estimate-print` | Estimate filament and print time |

---

## Security Notes

- OpenSCAD code is executed in an isolated temp directory. Each request gets a unique UUID directory that is deleted after the response is sent.
- Code is limited to 500 KB per request.
- Compile timeout is 55 seconds.
- The API accepts any CORS origin by default. Tighten the `origin` setting in `server.js` to your specific GitHub Pages URL for production.
- There is no authentication on the `/compile` endpoint. Add API key middleware if you expose this publicly.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML5, CSS3, Vanilla JS (ES Modules) |
| Editor | [CodeMirror 5](https://codemirror.net/5/) |
| 3D Viewer | [Three.js r160](https://threejs.org/) |
| Backend | Node.js 20 + [Express 4](https://expressjs.com/) |
| Compiler | [OpenSCAD](https://openscad.org/) |
| Headless display | Xvfb |
| Containerisation | Docker (Ubuntu 22.04 base) |
| Frontend hosting | GitHub Pages |
| Backend hosting | [Render](https://render.com) |
