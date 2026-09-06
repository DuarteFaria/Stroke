import unittest

from backend.benchmark import summarize


class BenchmarkTests(unittest.TestCase):
    def project(self):
        points = [{'x': 0.2, 'y': 0.3, 'v': 0.8} for _ in range(33)]
        points[15]['v'] = 0.2
        return {'name': 'test', 'segment': [0, 1], 'frames': [
            {'t': 0, 'points': points}, {'t': 0.1, 'points': None}],
            'corrections': [{'t': 0, 'points': {'15': {'v': 1}}}]}

    def test_missing_frames_count_against_joint_coverage(self):
        report = summarize(self.project())
        self.assertEqual(report['poseCoveragePercent'], 50)
        self.assertEqual(report['joints']['right_wrist']['coveragePercent'], 50)
        self.assertEqual(report['joints']['left_wrist']['coveragePercent'], 0)

    def test_empty_segment_is_unknown_not_perfect(self):
        project = self.project()
        project['frames'] = []
        self.assertIsNone(summarize(project)['poseCoveragePercent'])

    def test_duplicate_timestamps_rejected(self):
        project = self.project()
        project['frames'][1]['t'] = 0
        with self.assertRaises(ValueError):
            summarize(project)

    def test_threshold_and_segment(self):
        project = self.project()
        project['frames'].append({'t': 2, 'points': None})
        self.assertEqual(summarize(project, 0.1)['samples'], 2)
        self.assertEqual(summarize(project, 0.1)['joints']['left_wrist']['coveragePercent'], 50)
        with self.assertRaises(ValueError):
            summarize(project, float('nan'))
