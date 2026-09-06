import pytest
from backend.region_tracking import RegionFollower


def pose(x, y=.4, confidence=.9):
    return [{'x':x,'y':y,'v':confidence} for _ in range(33)]


def test_follows_displacement_preserves_margin_and_size():
    tracker=RegionFollower({'x':.2,'y':.1,'width':.4,'height':.6})
    assert tracker.update(pose(.35))=='following'
    tracker.update(pose(.38,.42))
    assert tracker.region==pytest.approx({'x':.23,'y':.12,'width':.4,'height':.6})


def test_uncertainty_and_jump_do_not_move_crop():
    tracker=RegionFollower({'x':.2,'y':.1,'width':.4,'height':.6})
    original=dict(tracker.region)
    tracker.update(pose(.35))
    assert tracker.update(pose(.5))=='uncertain'
    assert tracker.region==original
    tracker.update(pose(.5))
    assert tracker.update(None)=='uncertain'
    tracker.update(pose(.3))
    assert tracker.region==original
    assert tracker.update(pose(.31,confidence=.2))=='uncertain'
    assert tracker.region==original


def test_bounds_and_outside_observations():
    tracker=RegionFollower({'x':.59,'y':.1,'width':.4,'height':.6})
    tracker.update(pose(.85))
    tracker.update(pose(.88))
    assert tracker.region['x']==pytest.approx(.6)
    assert tracker.update(pose(1.1))=='uncertain'
    assert tracker.region['x']==pytest.approx(.6)
