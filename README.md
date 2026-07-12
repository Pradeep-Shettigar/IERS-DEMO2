# Shelf Watch — Shop Product Counter

Next.js frontend (Vercel) + FastAPI backend (Render), calling a Roboflow Rapid
model. Detects products on a shelf and counts an item as "sold" the moment
it leaves frame — either by disappearing, or by a trained `floor` class
detecting the now-empty spot where it used to sit.

## Structure
```
backend/
  main.py           FastAPI service — Roboflow API calls, NMS, IoU tracker, sold-counting logic
  requirements.txt
  runtime.txt       pins Python 3.11.9 (newer versions break inference-sdk installs)

frontend/
  app/page.tsx           Solo mode — upload a video OR use this device's own camera
  app/monitor/page.tsx   PC control panel — no camera needed, watches a remote feed
  app/camera/page.tsx    Phone camera sender — streams to a session created by /monitor
```

## How the two usage modes work

**Solo mode** (`/`): one device does everything — camera + viewing screen are the same.

**Remote mode** (`/monitor` + `/camera`): your PC is the dashboard, your phone is the camera.
1. Open `/monitor` on your PC → click **Start monitoring** → it shows a link
2. Open that link on your phone → tap **Start streaming**
3. The PC screen updates live with the phone's feed, boxes, and counts

## 1. Backend — run locally
```bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows
pip install -r requirements.txt

$env:ROBOFLOW_API_KEY="your_key_here"    # PowerShell
uvicorn main:app --reload --port 8000
```
Visit http://localhost:8000/health — should show `{"status": "ok", "api_key_set": true}`.

## 2. Frontend — run locally
```bash
cd frontend
npm install
copy .env.local.example .env.local   # then leave NEXT_PUBLIC_API_URL as localhost:8000
npm run dev
```
Visit http://localhost:3000.

## 3. Deploy backend (Render)
- New Web Service → point at `backend/`
- Root Directory: `backend`
- Build Command: `pip install -r requirements.txt`
- Start Command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
- Environment Variables → `ROBOFLOW_API_KEY = your_key_here`
- Also add `PYTHON_VERSION = 3.11.9` if the build picks the wrong Python version
- Note the deployed URL (e.g. `https://your-app.onrender.com`)

## 4. Deploy frontend (Vercel)
- Import the repo, set root directory to `frontend/`
- Environment Variables → `NEXT_PUBLIC_API_URL = https://your-backend-url` (no trailing slash)
- Deploy

## Your Roboflow config
Set these at the top of `backend/main.py`:
```python
WORKSPACE_NAME = "pradeep-kgynu"
WORKFLOW_ID = "find-bottle-and-pen"
```

## Detection classes
- `pen`, `bottle` — the actual products
- `floor` (optional but recommended) — label a few images of the empty shelf/table
  surface with no product on it. When a tracked item disappears and a `floor` box
  appears in roughly the same spot, it's counted sold immediately instead of waiting
  for a timeout. Improves accuracy a lot — see main.py's `SimpleIoUTracker` for the logic.

## Tuning knobs
All in `backend/main.py` / `frontend/app/*/page.tsx`:
- `CONFIDENCE` (frontend) — higher = fewer false positives, may miss weak detections
- `missing_threshold` (backend, passed via `/session/new`) — how many missed frames
  before a disappeared item counts as sold (fallback for when `floor` isn't detected)
- `apply_nms` iou_threshold (backend) — collapses duplicate overlapping boxes on the
  same physical object into one
- `FRAME_INTERVAL_MS` (frontend) — how often a frame is sent to the API; lower = more
  responsive, more API calls

## Notes
- The Roboflow API key only ever lives on the backend as an environment variable —
  it's never sent to the browser.
- Render's free tier spins down when idle; the first request after inactivity can
  take 30-50 seconds to respond. Normal, not a bug.
- Tracking state lives in-memory per session on the backend — fine for demo/portfolio
  use; would need Redis/a database for multi-instance production scaling.
- Webcam access requires HTTPS — works fine once deployed on Vercel, but won't work
  over plain `http://` except on `localhost` itself.
