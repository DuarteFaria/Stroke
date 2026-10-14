from types import SimpleNamespace
import numpy as np
import pytest
from backend import main


@pytest.mark.parametrize('value',[None,[[2,1]],[[0,2],[1,3]],[[0,float('nan')]],[[True,2]]])
def test_invalid_intervals(value):
    with pytest.raises(ValueError): main.validate_transitions(value)


def test_excludes_blend_recreates_detector_and_cleans_up(monkeypatch):
    instances=[]
    class Capture:
        index=-1
        released=False
        def set(self,*args): pass
        def read(self):
            self.index+=1
            return True,np.zeros((20,20,3),dtype=np.uint8)
        def get(self,*args): return self.index*100
        def release(self): self.released=True
    class Detector:
        closed=False
        def __enter__(self): instances.append(self); return self
        def __exit__(self,*args): self.closed=True
        def detect_for_video(self,*args):
            return SimpleNamespace(pose_landmarks=[[SimpleNamespace(x=.5,y=.5,visibility=1,presence=1)]*33])
    cap=Capture()
    monkeypatch.setattr(main,'inspect_video',lambda _:dict(fps=10,duration=.5,frameCount=5,width=20,height=20))
    monkeypatch.setattr(main.cv2,'VideoCapture',lambda _:cap)
    monkeypatch.setattr(main.mp.tasks.vision.PoseLandmarker,'create_from_options',lambda _:Detector())
    result=main.analyze('unused',0,.5,transitions=[[.1,.25]])
    assert [f['points'] is None for f in result['frames']]==[False,True,True,False,False]
    assert result['frames'][3]['breakBefore'] is True
    assert len(instances)==2 and all(d.closed for d in instances) and cap.released


def scene(hue,shift=0,light=0):
    # Textured stand-in for a shot: a hue ramp across, brightness down the frame.
    y,x=np.mgrid[0:72,0:128]
    hsv=np.stack([(hue+x*40/128+shift)%180,np.full(x.shape,200),np.clip(70+y*2+light,0,255)],-1).astype(np.uint8)
    return main.cv2.cvtColor(hsv,main.cv2.COLOR_HSV2BGR)


def analyze_frames(monkeypatch,images,**extra):
    class Capture:
        index=-1
        def set(self,*args): pass
        def read(self):
            self.index+=1
            return self.index<len(images),images[min(self.index,len(images)-1)]
        def get(self,*args): return self.index*100
        def release(self): pass
    class Detector:
        def __enter__(self): return self
        def __exit__(self,*args): pass
        def detect_for_video(self,*args):
            return SimpleNamespace(pose_landmarks=[[SimpleNamespace(x=.5,y=.5,visibility=1,presence=1)]*33])
    n=len(images)
    monkeypatch.setattr(main,'inspect_video',lambda _:dict(fps=10,duration=n/10,frameCount=n,width=128,height=72))
    monkeypatch.setattr(main.cv2,'VideoCapture',lambda _:Capture())
    monkeypatch.setattr(main.mp.tasks.vision.PoseLandmarker,'create_from_options',lambda _:Detector())
    return main.analyze('unused',0,(n-1)/10,**extra)


def test_hard_cut_found_and_breaks_tracking(monkeypatch):
    result=analyze_frames(monkeypatch,[scene(0,i) for i in range(6)]+[scene(100,i) for i in range(6)])
    assert result['cuts']==[[pytest.approx(.5),pytest.approx(.6)]]
    assert [round(f['t'],1) for f in result['frames'] if f.get('breakBefore')]==[.6]
    assert all(f['points'] for f in result['frames'])


def test_static_and_slowly_changing_shots_have_no_cuts(monkeypatch):
    assert analyze_frames(monkeypatch,[scene(30)]*12)['cuts']==[]
    result=analyze_frames(monkeypatch,[scene(30,i*3,i*2) for i in range(30)])
    assert result['cuts']==[] and not any(f.get('breakBefore') for f in result['frames'])


def test_cuts_close_together_merge(monkeypatch):
    images=[scene(0)]*6+[scene(100)]*2+[scene(50)]*6
    assert analyze_frames(monkeypatch,images)['cuts']==[[pytest.approx(.5),pytest.approx(.8)]]


def test_cut_inside_user_transition_is_not_duplicated(monkeypatch):
    images=[scene(0)]*6+[scene(100)]*6
    result=analyze_frames(monkeypatch,images,transitions=[[.45,.65]])
    assert result['cuts']==[]
    assert [round(f['t'],1) for f in result['frames'] if f.get('breakBefore')]==[.7]
    # A hand-marked range that just misses the cut still absorbs it.
    result=analyze_frames(monkeypatch,images,transitions=[[.7,.9]])
    assert result['cuts']==[] and result['frames'][6].get('breakBefore')
