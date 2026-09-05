"""Loopback-only video analysis. Uploaded temporary videos are deleted after each job."""
from pathlib import Path
import math, os, tempfile, threading, uuid, time, secrets, sys
import cv2
import mediapipe as mp
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

ROOT = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parent.parent))
MODEL = ROOT / 'models' / 'pose_landmarker_full.task'
app = FastAPI(title='Stroke local analyzer')
TOKEN = os.environ.get('STROKE_TOKEN', '')
ORIGINS = {os.environ['STROKE_ORIGIN']} if os.environ.get('STROKE_ORIGIN') else {'http://127.0.0.1:3000', 'http://localhost:3000'}
app.add_middleware(CORSMiddleware, allow_origins=list(ORIGINS), allow_methods=['GET','POST','DELETE'], allow_headers=['Content-Type', 'X-Stroke-Token'])
JOBS = {}
LOCK = threading.Lock()

@app.middleware('http')
async def local_only(request: Request, call_next):
    if TOKEN and request.method != 'OPTIONS' and not secrets.compare_digest(request.headers.get('x-stroke-token', ''), TOKEN):
        return JSONResponse({'detail':'Unauthorized desktop session.'},status_code=401)
    if request.headers.get('origin') and request.headers['origin'] not in ORIGINS:
        return JSONResponse({'detail':'Only the local Stroke app can use this service.'},status_code=403)
    return await call_next(request)

@app.get('/health')
def health():
    return {'ok':True,'modelReady':MODEL.exists()}

def inspect_video(path):
    cap=cv2.VideoCapture(str(path))
    try:
        fps=cap.get(cv2.CAP_PROP_FPS); count=cap.get(cv2.CAP_PROP_FRAME_COUNT)
        w=cap.get(cv2.CAP_PROP_FRAME_WIDTH); h=cap.get(cv2.CAP_PROP_FRAME_HEIGHT)
        if not cap.isOpened() or not all(math.isfinite(v) and v>0 for v in [fps,count,w,h]):
            raise ValueError('This video could not be decoded. Try an MP4 encoded with H.264.')
        return dict(fps=fps,duration=count/fps,width=int(w),height=int(h),frameCount=int(count))
    finally: cap.release()

def analyze(path,start,end,progress=lambda p:None,cancel=lambda:False):
    meta=inspect_video(path)
    if not (0<=start<end<=meta['duration']+.1) or end-start>120:
        raise ValueError('Select a valid segment of up to 120 seconds within the video.')
    cap=cv2.VideoCapture(str(path)); frames=[]
    options=mp.tasks.vision.PoseLandmarkerOptions(base_options=mp.tasks.BaseOptions(model_asset_path=str(MODEL)),running_mode=mp.tasks.vision.RunningMode.VIDEO,num_poses=1,min_pose_detection_confidence=.4,min_pose_presence_confidence=.4,min_tracking_confidence=.5)
    # Decode each source frame; inference is sampled at <=15 fps. Preserve decoder timestamps.
    step=max(1,math.ceil(meta['fps']/15)); first=math.ceil(start*meta['fps']); last=min(meta['frameCount']-1,math.floor(end*meta['fps']))
    previous_ms=-1
    try:
        cap.set(cv2.CAP_PROP_POS_FRAMES,first)
        with mp.tasks.vision.PoseLandmarker.create_from_options(options) as detector:
            for index in range(first,last+1):
                if cancel(): return None
                ok,bgr=cap.read()
                if not ok: break
                if (index-first)%step: continue
                t=cap.get(cv2.CAP_PROP_POS_MSEC)/1000
                if not math.isfinite(t) or (index>0 and t<=0): t=index/meta['fps']
                if t>end+.001: break
                ms=max(previous_ms+1,round(t*1000)); previous_ms=ms
                if max(bgr.shape[:2])>1280:
                    bgr=cv2.resize(bgr,None,fx=1280/max(bgr.shape[:2]),fy=1280/max(bgr.shape[:2]))
                rgb=cv2.cvtColor(bgr,cv2.COLOR_BGR2RGB)
                result=detector.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB,data=rgb),ms)
                points=None
                if result.pose_landmarks:
                    points=[{'x':float(p.x),'y':float(p.y),'v':float(min(p.visibility,p.presence))} for p in result.pose_landmarks[0]]
                frames.append({'t':t,'points':points})
                progress(min(99,round((index-first+1)/max(1,last-first+1)*100)))
    finally: cap.release()
    detected=sum(f['points'] is not None for f in frames)
    return {**meta,'frames':frames,'start':start,'end':end,'sampleFps':meta['fps']/step,'detected':detected,'total':len(frames)}

def run_job(job_id,path,start,end):
    job=JOBS[job_id]
    try:
        result=analyze(path,start,end,lambda p:job.update(progress=p),lambda:job['cancel'])
        job.update(status='cancelled' if result is None else 'done',result=result,progress=100)
    except Exception as exc:
        job.update(status='error',error=str(exc))
    finally:
        Path(path).unlink(missing_ok=True); job['finished']=time.time()

@app.post('/analyze')
async def submit(file:UploadFile=File(...),start:float=Form(...),end:float=Form(...)):
    if not MODEL.exists(): raise HTTPException(503,'Pose model missing. Run the setup script.')
    if not all(math.isfinite(x) for x in [start,end]) or not 0<=start<end or end-start>120:
        raise HTTPException(400,'Choose a segment between 0 and 120 seconds long.')
    with LOCK:
        for k in list(JOBS):
            if JOBS[k].get('finished',time.time())<time.time()-3600: del JOBS[k]
        if any(j['status']=='running' for j in JOBS.values()): raise HTTPException(409,'Another analysis is running. Wait or cancel it first.')
        job_id=uuid.uuid4().hex; JOBS[job_id]={'status':'running','progress':0,'cancel':False}
    path=None
    try:
        with tempfile.NamedTemporaryFile(delete=False,suffix='.mp4') as temp:
            path=temp.name; total=0
            while chunk:=await file.read(1024*1024):
                total+=len(chunk)
                if total>1024**3: raise HTTPException(413,'This MVP accepts videos up to 1 GB. Trim a copy first.')
                temp.write(chunk)
        meta=inspect_video(path)
        if end>meta['duration']+.1: raise HTTPException(400,'Segment ends beyond the video duration.')
        threading.Thread(target=run_job,args=(job_id,path,start,end),daemon=True).start()
        return {'id':job_id,'metadata':meta}
    except Exception as exc:
        JOBS.pop(job_id,None)
        if path: Path(path).unlink(missing_ok=True)
        if isinstance(exc,HTTPException): raise
        raise HTTPException(400,str(exc)) from exc
    finally: await file.close()

@app.get('/jobs/{job_id}')
def get_job(job_id:str):
    if job_id not in JOBS: raise HTTPException(404,'Analysis not found. Please run it again.')
    return {k:v for k,v in JOBS[job_id].items() if k not in ['cancel','finished']}

@app.delete('/jobs/{job_id}')
def cancel_job(job_id:str):
    if job_id not in JOBS: raise HTTPException(404,'Analysis not found.')
    JOBS[job_id]['cancel']=True
    return {'ok':True}
