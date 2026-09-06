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
