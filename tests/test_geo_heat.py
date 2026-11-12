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


class TestSceneDefaults(unittest.TestCase):
    def test_known_scenes_have_expected_defaults(self):
        self.assertEqual(
            geo_heat.scene_defaults("sample"),
            {"radius": 36, "intensity": 100, "opacity": 90, "palette": "classic"},
        )
        self.assertEqual(geo_heat.scene_defaults("places")["radius"], 46)
        self.assertEqual(geo_heat.scene_defaults("custom")["palette"], "classic")

    def test_reset_state_is_a_fresh_copy(self):
        defaults = geo_heat.scene_defaults("sample")
        defaults["radius"] = 99
        # Mutating the returned state must not leak into the next reset.
        self.assertEqual(geo_heat.scene_defaults("sample")["radius"], 36)

    def test_unknown_scene_raises(self):
        with self.assertRaises(ValueError):
            geo_heat.scene_defaults("nope")


class TestPlaces(unittest.TestCase):
    PLACES = [
        {"n": "Cafe One", "lat": 40.8116, "lng": -73.9465, "c": "cafe"},
        {"n": "Bar Two", "lat": 40.7265, "lng": -73.9815, "c": "bar"},
        {"n": "Cafe Three", "lat": 40.8, "lng": -73.95, "c": "cafe"},
        {"n": "No Coords", "lat": None, "lng": None, "c": "cafe"},
        {"n": "Out Of Range", "lat": 999, "lng": 0, "c": "bar"},
        {"n": "No Category", "lat": 40.7, "lng": -73.99, "c": ""},
    ]

    def test_places_to_points_skips_bad_records(self):
        points = geo_heat.places_to_points(self.PLACES)
        self.assertEqual(len(points), 4)
        self.assertEqual(points[0]["name"], "Cafe One")
        self.assertEqual(points[0]["label"], "cafe")  # category doubles as label
        self.assertEqual(points[0]["category"], "cafe")
        self.assertEqual(points[0]["weight"], 1.0)

    def test_distinct_categories_ordered_by_count(self):
        points = geo_heat.places_to_points(self.PLACES)
        self.assertEqual(geo_heat.distinct_categories(points), ["cafe", "bar"])

    def test_filter_by_category(self):
        points = geo_heat.places_to_points(self.PLACES)
        self.assertEqual(len(geo_heat.filter_by_category(points, "all")), 4)
        cafes = geo_heat.filter_by_category(points, "cafe")
        self.assertEqual([p["name"] for p in cafes], ["Cafe One", "Cafe Three"])
        self.assertEqual(geo_heat.filter_by_category(points, "museum"), [])


class TestNeighborhoodLabels(unittest.TestCase):
    NYC_BOUNDS = (40.6, 40.9, -74.05, -73.7)  # min_lat, max_lat, min_lng, max_lng

    def test_labels_in_view(self):
        in_view = geo_heat.labels_in_view(geo_heat.NEIGHBORHOOD_LABELS, self.NYC_BOUNDS)
        self.assertEqual(len(in_view), len(geo_heat.NEIGHBORHOOD_LABELS))
        tight = geo_heat.labels_in_view(
            geo_heat.NEIGHBORHOOD_LABELS, (40.80, 40.82, -73.96, -73.93)
        )
        self.assertEqual([name for name, _, _ in tight], ["Harlem"])

    def test_label_projects_onto_canvas(self):
        # Harlem's label, projected with the same projection the points use,
        # must land inside a 960x600 canvas over an NYC-sized viewport.
        name, lat, lng = geo_heat.NEIGHBORHOOD_LABELS[0]
        self.assertEqual(name, "Harlem")
        x, y = geo_heat.project(lat, lng, self.NYC_BOUNDS, 960, 600)
        self.assertTrue(0 <= x <= 960)
        self.assertTrue(0 <= y <= 600)

    def test_nearest_label(self):
        # A cluster centre in Harlem resolves to Harlem; one in Flushing
        # resolves to Flushing.
        self.assertEqual(
            geo_heat.nearest_label(40.812, -73.947, geo_heat.NEIGHBORHOOD_LABELS),
            "Harlem",
        )
        self.assertEqual(
            geo_heat.nearest_label(40.767, -73.833, geo_heat.NEIGHBORHOOD_LABELS),
            "Flushing",
        )


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
