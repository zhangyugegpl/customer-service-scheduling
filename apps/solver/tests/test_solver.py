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
                "softConstraints": {"highestPriority": ["S1"], "weights": {"S1": 10, "S2": 8, "S3": 5, "S4": 5, "S5": 2}},
                "specifiedAssignments": [], "specifiedRestCounts": [],
            },
        }

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


if __name__ == "__main__":
    unittest.main()
