import json
from types import SimpleNamespace

import numpy as np
import pytest
from fastapi.testclient import TestClient
from backend import main


@pytest.mark.parametrize('region', [{}, {'x':0,'y':0,'width':0,'height':1},
    {'x':.8,'y':0,'width':.3,'height':1},
    {'x':False,'y':0,'width':1,'height':1},
    {'x':0,'y':0,'width':float('nan'),'height':1}])
def test_invalid_region(region):
    with pytest.raises(ValueError): main.validate_region(region)
    response=TestClient(main.app).post('/analyze',data={'start':0,'end':1,'region':json.dumps(region)},
                                      files={'file':('video.mp4',b'bad')})
    assert response.status_code == 400


def test_crop_uses_original_pixels_and_maps_landmarks(monkeypatch):
    image=np.zeros((1000,2000,3),dtype=np.uint8)
    class Capture:
        def set(self,*args): pass
        def read(self): return True,image
        def get(self,*args): return 0
        def release(self): pass
    class Detector:
        def __enter__(self): return self
        def __exit__(self,*args): pass
        def detect_for_video(self,frame,ms):
            assert frame.numpy_view().shape == (600,800,3)
            return SimpleNamespace(pose_landmarks=[[SimpleNamespace(
                x=.25,y=.5,visibility=.9,presence=.8) for _ in range(33)]])
    monkeypatch.setattr(main,'inspect_video',lambda _:dict(fps=1,duration=1,frameCount=1,width=2000,height=1000))
    monkeypatch.setattr(main.cv2,'VideoCapture',lambda _:Capture())
    monkeypatch.setattr(main.mp.tasks.vision.PoseLandmarker,'create_from_options',lambda _:Detector())
    result=main.analyze('unused',0,1,region={'x':.2,'y':.1,'width':.4,'height':.6})
    assert result['frames'][0]['points'][0] == pytest.approx({'x':.3,'y':.4,'v':.8})


def test_pixel_bounds_enclose_fractional_region():
    assert main.crop_bounds({'x':.125,'y':.125,'width':.5,'height':.5},10,10)==(1,1,7,7)
    assert main.crop_bounds(None,1920,1080)==(0,0,1920,1080)
