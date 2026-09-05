from pathlib import Path
import time
import pytest
from fastapi.testclient import TestClient
from backend import main

client=TestClient(main.app)


def test_desktop_session_requires_token_and_allowed_origin(monkeypatch):
    monkeypatch.setattr(main, 'TOKEN', 'test-desktop-session')
    assert client.get('/health').status_code == 401
    assert client.get('/health', headers={'X-Stroke-Token': 'wrong'}).status_code == 401
    assert client.get('/health', headers={'X-Stroke-Token': 'test-desktop-session'}).status_code == 200
    assert client.get('/health', headers={'X-Stroke-Token': 'test-desktop-session', 'Origin': 'https://unrelated.example'}).status_code == 403
    response = client.options('/analyze', headers={
        'Origin': 'http://127.0.0.1:3000',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'X-Stroke-Token',
    })
    assert response.status_code == 200

def test_health_and_origin_restriction():
    assert client.get('/health').status_code==200
    assert client.get('/health',headers={'Origin':'https://unrelated.example'}).status_code==403
    assert client.get('/health',headers={'Origin':'http://127.0.0.1:3000'}).status_code==200

@pytest.mark.parametrize('start,end',[(2,1),(-1,1),(0,121),('nan',1),(0,'inf')])
def test_invalid_segment(start,end):
    r=client.post('/analyze',data={'start':start,'end':end},files={'file':('bad.mp4',b'not a video','video/mp4')})
    assert r.status_code==400

def test_invalid_video_cleans_job():
    r=client.post('/analyze',data={'start':0,'end':1},files={'file':('bad.mp4',b'bad','video/mp4')})
    assert r.status_code==400
    assert not any(j['status']=='running' for j in main.JOBS.values())

def test_job_completion_and_temp_cleanup(monkeypatch):
    paths=[]
    monkeypatch.setattr(main,'inspect_video',lambda _:dict(duration=3))
    def fake(path,start,end,progress,cancel):
        paths.append(Path(path));progress(50);return {'frames':[],'total':0}
    monkeypatch.setattr(main,'analyze',fake)
    r=client.post('/analyze',data={'start':0,'end':1},files={'file':('clip.mp4',b'video','video/mp4')})
    assert r.status_code==200
    for _ in range(100):
        job=client.get('/jobs/'+r.json()['id']).json()
        if job['status']=='done' and not paths[0].exists():break
        time.sleep(.01)
    assert job['status']=='done' and job['result']['total']==0
    assert not paths[0].exists()

def test_cancellation_cleans_temp(monkeypatch):
    paths=[]
    monkeypatch.setattr(main,'inspect_video',lambda _:dict(duration=3))
    def fake(path,start,end,progress,cancel):
        paths.append(Path(path))
        for _ in range(200):
            if cancel():return None
            time.sleep(.005)
        raise AssertionError('Cancellation never arrived')
    monkeypatch.setattr(main,'analyze',fake)
    r=client.post('/analyze',data={'start':0,'end':1},files={'file':('clip.mp4',b'video','video/mp4')})
    job_id=r.json()['id'];assert client.delete('/jobs/'+job_id).status_code==200
    for _ in range(100):
        job=client.get('/jobs/'+job_id).json()
        if job['status']=='cancelled' and paths and not paths[0].exists():break
        time.sleep(.01)
    assert job['status']=='cancelled' and not paths[0].exists()
