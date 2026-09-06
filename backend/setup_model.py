from pathlib import Path
from urllib.request import urlretrieve
root=Path(__file__).resolve().parent.parent
for variant in ('full','heavy'):
    model=root/'models'/f'pose_landmarker_{variant}.task'
    model.parent.mkdir(exist_ok=True)
    if not model.exists():
        temp=model.with_suffix('.download')
        urlretrieve(f'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_{variant}/float16/1/pose_landmarker_{variant}.task',temp)
        temp.replace(model)
    print('Pose model ready:',model)
