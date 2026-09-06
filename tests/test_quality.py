from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from backend import main


def test_unknown_quality_rejected():
    with pytest.raises(ValueError,match='quality'):
        main.analyze('unused',0,1,quality='unknown')
    response=TestClient(main.app).post('/analyze',data={'start':0,'end':1,'quality':'unknown'},files={'file':('a.mp4',b'bad')})
    assert response.status_code==400


def test_missing_detailed_model_is_actionable(monkeypatch,tmp_path):
    monkeypatch.setattr(main,'MODEL',tmp_path/'pose_landmarker_full.task')
    response=TestClient(main.app).post('/analyze',data={'start':0,'end':1,'quality':'detailed'},files={'file':('a.mp4',b'bad')})
    assert response.status_code==503
    assert 'setup_model.py' in response.json()['detail']
