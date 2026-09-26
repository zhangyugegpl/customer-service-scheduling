from __future__ import annotations

import sys
import unittest
from pathlib import Path

SOLVER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SOLVER_DIR))

from model import solve_request  # noqa: E402


class SolverTest(unittest.TestCase):
    def build_request(self) -> dict:
        position = "00000000-0000-4000-8000-000000000101"
        employees = [
            {
                "id": f"00000000-0000-4000-8000-{index:012d}",
                "code": f"E{index}",
                "name": f"员工{index}",
                "active": True,
                "skillPositionIds": [position],
                "monthlyRestDays": 0,
            }
            for index in range(1, 3)
        ]
        return {
            "targetMonth": "2026-02",
            "timeLimitSeconds": 2,
            "randomSeed": 1,
            "config": {
                "employees": employees,
                "positions": [{"id": position, "name": "早班", "defaultMinQuota": 1, "dateQuotaOverrides": {}}],
                "rules": {
                    "groups": [], "exclusionPairs": [], "weeklyWorkMin": 0, "weeklyWorkMax": 7,
                    "preferredWeeklyWorkDays": 6, "consecutiveRestSegmentsMin": 0,
                    "consecutiveRestSegmentsMax": 28, "workBetweenRestMin": 0, "workBetweenRestMax": 28,
                },
                "softConstraints": {
                    "highestPriority": ["S1"],
                    "weights": {"S1": 10, "S2": 8, "S3": 5, "S4": 5, "S5": 2},
                    "modes": {"S1": "SOFT", "S2": "SOFT", "S3": "SOFT", "S4": "SOFT", "S5": "SOFT"},
                },
                "specifiedAssignments": [], "specifiedRestCounts": [],
            },
        }

    def build_middle_request(self) -> dict:
        request = self.build_request()
        early = request["config"]["positions"][0]["id"]
        middle = "00000000-0000-4000-8000-000000000102"
        request["config"]["positions"] = [
            {"id": early, "name": "早班", "defaultMinQuota": 1, "dateQuotaOverrides": {}},
            {"id": middle, "name": "中班", "defaultMinQuota": 1, "dateQuotaOverrides": {}},
        ]
        for employee in request["config"]["employees"]:
            employee["skillPositionIds"] = [early, middle]
        request["config"]["rules"]["middleShiftMaxRange"] = 0
        request["config"]["softConstraints"]["modes"]["S2"] = "HARD"
        return request

    def test_returns_publishable_schedule(self) -> None:
        result = solve_request(self.build_request())
        self.assertEqual(result["status"], "PUBLISHABLE")
        self.assertEqual(len(result["assignments"]), 2 * 28)

    def test_smart_change_is_locked(self) -> None:
        request = self.build_request()
        employee_id = request["config"]["employees"][0]["id"]
        request["requestedChange"] = {"employeeId": employee_id, "date": "2026-02-01", "state": "OFF"}
        request["config"]["employees"][0]["monthlyRestDays"] = 1
        result = solve_request(request)
        assignment = next(value for value in result["assignments"] if value["employeeId"] == employee_id and value["date"] == "2026-02-01")
        self.assertEqual(assignment["state"], "OFF")

    def test_specified_date_range_locks_every_day(self) -> None:
        request = self.build_request()
        employee_id = request["config"]["employees"][0]["id"]
        request["config"]["employees"][0]["monthlyRestDays"] = 3
        request["config"]["specifiedAssignments"] = [{
            "id": "10000000-0000-4000-8000-000000000001",
            "employeeId": employee_id,
            "date": "2026-02-03",
            "endDate": "2026-02-05",
            "state": "OFF",
            "locked": True,
        }]
        result = solve_request(request)
        locked = {
            value["date"]: value["state"]
            for value in result["assignments"]
            if value["employeeId"] == employee_id and "2026-02-03" <= value["date"] <= "2026-02-05"
        }
        self.assertEqual(locked, {"2026-02-03": "OFF", "2026-02-04": "OFF", "2026-02-05": "OFF"})

    def test_hard_s2_enforces_configured_middle_shift_range(self) -> None:
        request = self.build_middle_request()
        result = solve_request(request)
        middle = request["config"]["positions"][1]["id"]
        counts = [
            sum(1 for value in result["assignments"] if value["employeeId"] == employee["id"] and value["state"] == middle)
            for employee in request["config"]["employees"]
        ]
        self.assertEqual(result["status"], "PUBLISHABLE")
        self.assertEqual(max(counts) - min(counts), 0)

    def test_impossible_hard_s2_returns_exception_schedule(self) -> None:
        request = self.build_middle_request()
        employee_id = request["config"]["employees"][0]["id"]
        middle = request["config"]["positions"][1]["id"]
        request["config"]["specifiedAssignments"] = [{
            "id": "10000000-0000-4000-8000-000000000031",
            "employeeId": employee_id,
            "date": "2026-02-01",
            "endDate": "2026-02-28",
            "state": middle,
            "locked": True,
        }]
        result = solve_request(request)
        self.assertEqual(result["status"], "EXCEPTION")


if __name__ == "__main__":
    unittest.main()
