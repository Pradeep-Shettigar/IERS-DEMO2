"""
main.py
FastAPI backend for the shop product counter.
Wraps Roboflow Rapid API calls + a custom IoU tracker behind simple HTTP endpoints
that a Next.js frontend can call.

Run locally: uvicorn main:app --reload --port 8000
Deploy: Render / Railway (set ROBOFLOW_API_KEY as an environment variable there)
"""

import os
import uuid
import base64
from collections import defaultdict
from typing import Dict

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import cv2
import numpy as np
from inference_sdk import InferenceHTTPClient

# ---------------- CONFIG ----------------
API_URL = "https://detect.roboflow.com"
API_KEY = os.environ.get("ROBOFLOW_API_KEY", "")
WORKSPACE_NAME = "pradeep-kgynu"
WORKFLOW_ID = "find-bottle-and-pen"
# -----------------------------------------

app = FastAPI(title="Shop Product Counter API")

# Allow your Vercel frontend to call this backend.
# Replace "*" with your actual Vercel URL once deployed, for tighter security.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------- Tracker (same logic as local predict.py) ----------------
class SimpleIoUTracker:
    def __init__(self, iou_threshold=0.25, missing_threshold=4, edge_margin=60,
                 require_edge=False, floor_class="floor", floor_iou_threshold=0.35):
        self.next_id = 0
        self.tracks = {}
        self.iou_threshold = iou_threshold
        self.missing_threshold = missing_threshold
        self.edge_margin = edge_margin
        self.require_edge = require_edge
        self.floor_class = floor_class          # class name for "empty space" detections
        self.floor_iou_threshold = floor_iou_threshold
        self.sold_counts = defaultdict(int)
        self.frame_idx = 0

    @staticmethod
    def _iou(box_a, box_b):
        xa1, ya1, xa2, ya2 = box_a
        xb1, yb1, xb2, yb2 = box_b
        inter_x1, inter_y1 = max(xa1, xb1), max(ya1, yb1)
        inter_x2, inter_y2 = min(xa2, xb2), min(ya2, yb2)
        inter_area = max(0, inter_x2 - inter_x1) * max(0, inter_y2 - inter_y1)
        area_a = (xa2 - xa1) * (ya2 - ya1)
        area_b = (xb2 - xb1) * (yb2 - yb1)
        union = area_a + area_b - inter_area
        return inter_area / union if union > 0 else 0

    def _near_edge(self, bbox, w, h):
        x1, y1, x2, y2 = bbox
        return (x1 < self.edge_margin or y1 < self.edge_margin
                or x2 > w - self.edge_margin or y2 > h - self.edge_margin)

    def update(self, detections, frame_w, frame_h):
        # separate real product detections from "floor/empty" detections
        product_dets = [d for d in detections if d["class"] != self.floor_class]
        floor_dets = [d for d in detections if d["class"] == self.floor_class]

        unmatched = list(range(len(product_dets)))
        for tid, track in list(self.tracks.items()):
            best_iou, best_idx = 0, None
            for di in unmatched:
                det = product_dets[di]
                if det["class"] != track["class"]:
                    continue
                iou = self._iou(track["bbox"], det["bbox"])
                if iou > best_iou:
                    best_iou, best_idx = iou, di
            if best_idx is not None and best_iou >= self.iou_threshold:
                det = product_dets[best_idx]
                track["bbox"] = det["bbox"]
                track["last_seen"] = self.frame_idx
                unmatched.remove(best_idx)
            else:
                # not matched this frame — check if a "floor" detection now covers its old spot,
                # meaning the product was very likely just removed. Count it sold immediately.
                for fd in floor_dets:
                    if self._iou(track["bbox"], fd["bbox"]) >= self.floor_iou_threshold:
                        self.sold_counts[track["class"]] += 1
                        del self.tracks[tid]
                        break

        for di in unmatched:
            det = product_dets[di]
            self.tracks[self.next_id] = {
                "class": det["class"], "bbox": det["bbox"], "last_seen": self.frame_idx
            }
            self.next_id += 1

        to_remove = []
        for tid, track in self.tracks.items():
            if self.frame_idx - track["last_seen"] > self.missing_threshold:
                if (not self.require_edge) or self._near_edge(track["bbox"], frame_w, frame_h):
                    self.sold_counts[track["class"]] += 1
                to_remove.append(tid)
        for tid in to_remove:
            del self.tracks[tid]

        self.frame_idx += 1

    def get_live_counts(self):
        live = defaultdict(int)
        for track in self.tracks.values():
            if track["last_seen"] == self.frame_idx - 1:
                live[track["class"]] += 1
        return dict(live)


def _box_iou(box_a, box_b):
    xa1, ya1, xa2, ya2 = box_a
    xb1, yb1, xb2, yb2 = box_b
    inter_x1, inter_y1 = max(xa1, xb1), max(ya1, yb1)
    inter_x2, inter_y2 = min(xa2, xb2), min(ya2, yb2)
    inter_area = max(0, inter_x2 - inter_x1) * max(0, inter_y2 - inter_y1)
    area_a = (xa2 - xa1) * (ya2 - ya1)
    area_b = (xb2 - xb1) * (yb2 - yb1)
    union = area_a + area_b - inter_area
    return inter_area / union if union > 0 else 0


def apply_nms(detections, iou_threshold=0.4):
    """Collapses overlapping same-class detections down to the single highest-confidence
    box, so one physical object doesn't get counted/tracked as several."""
    by_class = defaultdict(list)
    for d in detections:
        by_class[d["class"]].append(d)

    kept = []
    for cls, dets in by_class.items():
        dets = sorted(dets, key=lambda d: d["conf"], reverse=True)
        chosen = []
        for d in dets:
            if all(_box_iou(d["bbox"], c["bbox"]) < iou_threshold for c in chosen):
                chosen.append(d)
        kept.extend(chosen)
    return kept


def detect_via_api(frame: np.ndarray, confidence: float = 0.5):
    """Calls the Roboflow Rapid workflow on a single frame (numpy BGR array)."""
    if not API_KEY:
        raise HTTPException(status_code=500, detail="ROBOFLOW_API_KEY not set on server")

    client = InferenceHTTPClient(api_url=API_URL, api_key=API_KEY)

    tmp_path = f"/tmp/{uuid.uuid4().hex}.jpg"
    cv2.imwrite(tmp_path, frame)
    try:
        result = client.run_workflow(
            workspace_name=WORKSPACE_NAME,
            workflow_id=WORKFLOW_ID,
            images={"image": tmp_path},
            use_cache=True,
        )
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

    try:
        preds = result[0]["predictions"]["predictions"]
    except (KeyError, IndexError, TypeError):
        preds = []

    detections = []
    for p in preds:
        if p.get("confidence", 0) < confidence:
            continue
        cx, cy, w, h = p["x"], p["y"], p["width"], p["height"]
        x1, y1, x2, y2 = cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2
        detections.append({"class": p["class"], "bbox": (x1, y1, x2, y2), "conf": p["confidence"]})

    return apply_nms(detections, iou_threshold=0.4)


# ---------------- Session store ----------------
# Keeps one tracker per session so counts persist across frame calls.
# In-memory only: fine for a single-instance deployment / demo use.
sessions: Dict[str, SimpleIoUTracker] = {}
last_frames: Dict[str, bytes] = {}  # latest raw jpg bytes per session, for viewer polling


class ResetResponse(BaseModel):
    session_id: str


@app.post("/session/new", response_model=ResetResponse)
def new_session(missing_threshold: int = 4, require_edge: bool = False):
    session_id = uuid.uuid4().hex
    sessions[session_id] = SimpleIoUTracker(
        missing_threshold=missing_threshold, require_edge=require_edge
    )
    return {"session_id": session_id}


@app.post("/session/{session_id}/frame")
async def process_frame(session_id: str, file: UploadFile = File(...), confidence: float = 0.5):
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Unknown session_id — call /session/new first")

    tracker = sessions[session_id]

    contents = await file.read()
    last_frames[session_id] = contents  # store raw jpg for viewer clients to poll

    npbuf = np.frombuffer(contents, np.uint8)
    frame = cv2.imdecode(npbuf, cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(status_code=400, detail="Could not decode image")

    h, w = frame.shape[:2]
    detections = detect_via_api(frame, confidence=confidence)
    tracker.update(detections, w, h)

    boxes = [
        {
            "class": t["class"],
            "bbox": [round(v, 1) for v in t["bbox"]],
        }
        for t in tracker.tracks.values()
    ]

    return {
        "live_counts": tracker.get_live_counts(),
        "sold_counts": dict(tracker.sold_counts),
        "boxes": boxes,
    }


@app.get("/session/{session_id}/status")
def get_status(session_id: str):
    """Read-only poll for a viewer client (e.g. the PC dashboard) — no camera needed,
    just reads whatever the last camera client (e.g. phone) submitted."""
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Unknown session_id")
    tracker = sessions[session_id]

    boxes = [
        {"class": t["class"], "bbox": [round(v, 1) for v in t["bbox"]]}
        for t in tracker.tracks.values()
    ]

    frame_b64 = None
    if session_id in last_frames:
        frame_b64 = base64.b64encode(last_frames[session_id]).decode("utf-8")

    return {
        "live_counts": tracker.get_live_counts(),
        "sold_counts": dict(tracker.sold_counts),
        "boxes": boxes,
        "frame_jpg_base64": frame_b64,
    }


@app.delete("/session/{session_id}")
def end_session(session_id: str):
    sessions.pop(session_id, None)
    last_frames.pop(session_id, None)
    return {"status": "deleted"}


@app.get("/health")
def health():
    return {"status": "ok", "api_key_set": bool(API_KEY)}
