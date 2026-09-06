"""Conservative translation of a crop using reliable shoulder observations."""
import math


class RegionFollower:
    def __init__(self, region):
        self.region = dict(region)
        self.previous = None

    def update(self, points):
        # Freeze on uncertainty. The next reliable sample establishes a fresh
        # anchor, avoiding a jump accumulated across an occlusion or cut.
        if not points or any(points[i]['v'] < .7 for i in (11, 12)):
            self.previous = None
            return 'uncertain'
        center = tuple(sum(points[i][axis] for i in (11, 12)) / 2 for axis in ('x', 'y'))
        r = self.region
        if not all(math.isfinite(v) for v in center) or not (
                r['x'] <= center[0] <= r['x'] + r['width'] and
                r['y'] <= center[1] <= r['y'] + r['height']):
            self.previous = None
            return 'uncertain'
        if self.previous is not None:
            dx, dy = (center[i] - self.previous[i] for i in (0, 1))
            if abs(dx) > r['width'] * .12 or abs(dy) > r['height'] * .12:
                self.previous = None
                return 'uncertain'
            self.region = {**r, 'x': min(max(0, r['x'] + dx), 1-r['width']),
                           'y': min(max(0, r['y'] + dy), 1-r['height'])}
        self.previous = center
        return 'following'
