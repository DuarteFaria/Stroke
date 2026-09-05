from pathlib import Path
from urllib.request import urlretrieve
root=Path(__file__).resolve().parent.parent
model=root/'models'/'pose_landmarker_full.task'
model.parent.mkdir(exist_ok=True)
if not model.exists():
    temp=model.with_suffix('.download')
    urlretrieve('https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',temp)
    temp.replace(model)
print('Pose model ready:',model)
