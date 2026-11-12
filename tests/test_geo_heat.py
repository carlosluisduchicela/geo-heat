import io
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import geo_heat  # noqa: E402


class TestCsvParsing(unittest.TestCase):
    def test_skips_bad_rows(self):
        text = io.StringIO(
            "lat,lng,weight,label\n"
            "40.0,-73.0,2,cafe\n"
            ",-73.0,1,missing lat\n"
            "40.1,,1,missing lng\n"
            "not-a-number,-73.0,1,bad lat\n"
            "40.2,also-bad,1,bad lng\n"
            "999,999,1,out of range\n"
            "40.3,-73.3,,park\n"
        )
        points = geo_heat.read_points(text)
        self.assertEqual(len(points), 2)
        self.assertEqual(points[0]["label"], "cafe")
        self.assertEqual(points[0]["weight"], 2.0)
        self.assertEqual(points[1]["label"], "park")
        self.assertEqual(points[1]["weight"], 1.0)  # empty weight defaults to 1

    def test_empty_input_gives_no_points(self):
        points = geo_heat.read_points(io.StringIO("lat,lng,weight,label\n"))
        self.assertEqual(points, [])


class TestProjection(unittest.TestCase):
    def test_bounds_map_to_corners(self):
        bounds = (40.0, 41.0, -74.0, -73.0)  # min_lat, max_lat, min_lng, max_lng
        width, height = 200, 100
        # North-west corner: max lat, min lng -> (0, 0)
        self.assertEqual(geo_heat.project(41.0, -74.0, bounds, width, height), (0.0, 0.0))
        # South-east corner: min lat, max lng -> (width, height)
        self.assertEqual(geo_heat.project(40.0, -73.0, bounds, width, height), (200.0, 100.0))
        # Centre
        self.assertEqual(geo_heat.project(40.5, -73.5, bounds, width, height), (100.0, 50.0))

    def test_compute_bounds(self):
        points = [
            {"lat": 40.0, "lng": -73.0, "weight": 1, "label": "a"},
            {"lat": 41.0, "lng": -74.0, "weight": 1, "label": "b"},
        ]
        self.assertEqual(geo_heat.compute_bounds(points), (40.0, 41.0, -74.0, -73.0))


class TestGridDensity(unittest.TestCase):
    def test_picks_known_cluster_center_cell(self):
        # A tight cluster around the centre of a grid cell (40.45, -73.45)
        # plus scattered outliers, in a field spanning lat 40..41, lng -74..-73.
        points = [
            {"lat": 40.0, "lng": -74.0, "weight": 1, "label": "edge"},
            {"lat": 41.0, "lng": -73.0, "weight": 1, "label": "edge"},
        ]
        for i in range(8):
            points.append({
                "lat": 40.45 + (i % 3) * 0.002,
                "lng": -73.45 + (i % 2) * 0.002,
                "weight": 1,
                "label": "cluster",
            })
        cell = geo_heat.densest_cell(points, grid=10)
        self.assertEqual(cell["count"], 8)
        self.assertAlmostEqual(cell["center_lat"], 40.45, places=2)
        self.assertAlmostEqual(cell["center_lng"], -73.45, places=2)

    def test_top_labels(self):
        points = [
            {"lat": 40.0, "lng": -73.0, "weight": 1, "label": "cafe"},
            {"lat": 40.1, "lng": -73.1, "weight": 1, "label": "cafe"},
            {"lat": 40.2, "lng": -73.2, "weight": 1, "label": "park"},
            {"lat": 40.3, "lng": -73.3, "weight": 1, "label": ""},
        ]
        self.assertEqual(geo_heat.top_labels(points), [("cafe", 2), ("park", 1)])


class TestRender(unittest.TestCase):
    def test_render_html_embeds_points_and_is_standalone(self):
        points = [{"lat": 40.0, "lng": -73.0, "weight": 2, "label": "cafe"}]
        html = geo_heat.render_html(points, title="Test Map")
        self.assertIn("Test Map", html)
        self.assertIn('"lat": 40.0', html)
        self.assertNotIn("http://", html)
        self.assertNotIn("https://", html)


if __name__ == "__main__":
    unittest.main()
