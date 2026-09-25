from __future__ import annotations

import calendar
import time
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

from ortools.sat.python import cp_model

SOLVER_VERSION = "1.0.0"


def month_dates(target_month: str) -> list[str]:
    year, month = (int(value) for value in target_month.split("-"))
    return [f"{year:04d}-{month:02d}-{day:02d}" for day in range(1, calendar.monthrange(year, month)[1] + 1)]


def quota_for(position: dict[str, Any], day: str) -> int:
    return int(position.get("dateQuotaOverrides", {}).get(day, position["defaultMinQuota"]))


def and_var(model: cp_model.CpModel, name: str, values: list[cp_model.IntVar]) -> cp_model.IntVar:
    result = model.new_bool_var(name)
    for value in values:
        model.add(result <= value)
    model.add(result >= sum(values) - len(values) + 1)
    return result


@dataclass
class BuiltModel:
    model: cp_model.CpModel
    variables: dict[tuple[str, str, str], cp_model.IntVar]
    active_employees: list[dict[str, Any]]
    positions: list[dict[str, Any]]
    dates: list[str]
    hard_penalties: list[cp_model.LinearExpr]
    soft_penalties: dict[str, list[cp_model.LinearExpr]]
    change_penalties: list[cp_model.LinearExpr]


def build_model(request: dict[str, Any], relaxed: bool) -> BuiltModel:
    config = request["config"]
    employees = [employee for employee in config["employees"] if employee.get("active", True)]
    positions = config["positions"]
    dates = month_dates(request["targetMonth"])
    model = cp_model.CpModel()
    variables: dict[tuple[str, str, str], cp_model.IntVar] = {}
    hard_penalties: list[cp_model.LinearExpr] = []
    soft_penalties: dict[str, list[cp_model.LinearExpr]] = {key: [] for key in ("S1", "S2", "S3", "S4", "S5")}
    change_penalties: list[cp_model.LinearExpr] = []

    position_ids = [position["id"] for position in positions]
    for employee in employees:
        allowed_states = ["OFF", *[position_id for position_id in position_ids if position_id in employee["skillPositionIds"]]]
        for day in dates:
            day_variables = []
            for state in allowed_states:
                variable = model.new_bool_var(f"x_{employee['id']}_{day}_{state}")
                variables[(employee["id"], day, state)] = variable
                day_variables.append(variable)
            model.add_exactly_one(day_variables)

    # H2：岗位最低配额。
    for day in dates:
        for position in positions:
            assigned = [variables[(employee["id"], day, position["id"])] for employee in employees if (employee["id"], day, position["id"]) in variables]
            quota = quota_for(position, day)
            if relaxed:
                shortage = model.new_int_var(0, quota, f"coverage_shortage_{day}_{position['id']}")
                model.add(sum(assigned) + shortage >= quota)
                hard_penalties.append(shortage * 100)
            else:
                model.add(sum(assigned) >= quota)

    # H3：精确月休。
    for employee in employees:
        rests = [variables[(employee["id"], day, "OFF")] for day in dates]
        target = int(employee["monthlyRestDays"])
        if relaxed:
            below = model.new_int_var(0, len(dates), f"rest_below_{employee['id']}")
            above = model.new_int_var(0, len(dates), f"rest_above_{employee['id']}")
            model.add(sum(rests) + below - above == target)
            hard_penalties.extend([below * 30, above * 30])
        else:
            model.add(sum(rests) == target)

    # H4：组内当日至多休一人。
    for group in config["rules"].get("groups", []):
        for day in dates:
            rests = [variables[(employee_id, day, "OFF")] for employee_id in group["employeeIds"] if (employee_id, day, "OFF") in variables]
            if relaxed:
                excess = model.new_int_var(0, max(0, len(rests) - 1), f"group_excess_{group['id']}_{day}")
                model.add(excess >= sum(rests) - 1)
                hard_penalties.append(excess * 20)
            else:
                model.add(sum(rests) <= 1)

    # H5：互斥对不能同休。
    for pair in config["rules"].get("exclusionPairs", []):
        first, second = pair["employeeIds"]
        for day in dates:
            if (first, day, "OFF") not in variables or (second, day, "OFF") not in variables:
                continue
            both = and_var(model, f"pair_both_{pair['id']}_{day}", [variables[(first, day, "OFF")], variables[(second, day, "OFF")]])
            if relaxed:
                hard_penalties.append(both * 20)
            else:
                model.add(both == 0)

    # H6/H7/H9：指定状态始终锁定；预检查负责排除无技能或冲突指定。
    seen_locks: set[tuple[str, str, str]] = set()
    for locked in config.get("specifiedAssignments", []):
        key = (locked["employeeId"], locked["date"], locked["state"])
        if key in variables and key not in seen_locks:
            model.add(variables[key] == 1)
            seen_locks.add(key)

    # H8：指定日期休息人数。
    for specified in config.get("specifiedRestCounts", []):
        day = specified["date"]
        rests = [variables[(employee["id"], day, "OFF")] for employee in employees if (employee["id"], day, "OFF") in variables]
        target = int(specified["count"])
        if relaxed:
            below = model.new_int_var(0, len(employees), f"daily_rest_below_{day}")
            above = model.new_int_var(0, len(employees), f"daily_rest_above_{day}")
            model.add(sum(rests) + below - above == target)
            hard_penalties.extend([below * 30, above * 30])
        else:
            model.add(sum(rests) == target)

    requested = request.get("requestedChange")
    if requested:
        requested_key = (requested["employeeId"], requested["date"], requested["state"])
        if requested_key not in variables:
            raise ValueError("智能调班目标状态不属于员工可用状态。")
        model.add(variables[requested_key] == 1)

    current_by_key = {
        (assignment["employeeId"], assignment["date"]): assignment["state"]
        for assignment in request.get("currentAssignments", [])
    }
    for (employee_id, day), current_state in current_by_key.items():
        current_var = variables.get((employee_id, day, current_state))
        if current_var is not None:
            change_penalties.append(1 - current_var)

    # S1：工作日之间岗位切换，包含上月最后一个已知状态。
    boundary_by_employee = {
        value["employeeId"]: value for value in request.get("boundaryState", {}).get("employees", [])
    }
    for employee in employees:
        employee_id = employee["id"]
        states = [position_id for position_id in position_ids if (employee_id, dates[0], position_id) in variables]
        previous = boundary_by_employee.get(employee_id, {}).get("recentStates", [])
        if previous:
            previous_state = previous[-1]["state"]
            if previous_state != "OFF":
                for state in states:
                    if state != previous_state:
                        soft_penalties["S1"].append(variables[(employee_id, dates[0], state)])
        for day_index in range(1, len(dates)):
            before_day = dates[day_index - 1]
            day = dates[day_index]
            for before_state in states:
                for after_state in states:
                    if before_state == after_state:
                        continue
                    transition = and_var(
                        model,
                        f"switch_{employee_id}_{day}_{before_state}_{after_state}",
                        [variables[(employee_id, before_day, before_state)], variables[(employee_id, day, after_state)]],
                    )
                    soft_penalties["S1"].append(transition)

    # S2：中班员工数量极差超过 3 的部分。
    middle = next((position for position in positions if "中" in position["name"]), None)
    if middle:
        counts = []
        for employee in employees:
            if (employee["id"], dates[0], middle["id"]) not in variables:
                continue
            count = model.new_int_var(0, len(dates), f"middle_count_{employee['id']}")
            model.add(count == sum(variables[(employee["id"], day, middle["id"])] for day in dates))
            counts.append(count)
        if counts:
            maximum = model.new_int_var(0, len(dates), "middle_max")
            minimum = model.new_int_var(0, len(dates), "middle_min")
            model.add_max_equality(maximum, counts)
            model.add_min_equality(minimum, counts)
            excess = model.new_int_var(0, len(dates), "middle_range_excess")
            model.add(excess >= maximum - minimum - 3)
            soft_penalties["S2"].append(excess)

    # S3：用相邻双休对数量近似连续 2 天休息段。
    minimum_segments = int(config["rules"]["consecutiveRestSegmentsMin"])
    maximum_segments = int(config["rules"]["consecutiveRestSegmentsMax"])
    for employee in employees:
        pairs = []
        for day_index in range(1, len(dates)):
            pairs.append(and_var(model, f"rest_pair_{employee['id']}_{dates[day_index]}", [
                variables[(employee["id"], dates[day_index - 1], "OFF")],
                variables[(employee["id"], dates[day_index], "OFF")],
            ]))
        below = model.new_int_var(0, len(dates), f"rest_segments_below_{employee['id']}")
        above = model.new_int_var(0, len(dates), f"rest_segments_above_{employee['id']}")
        model.add(below >= minimum_segments - sum(pairs))
        model.add(above >= sum(pairs) - maximum_segments)
        soft_penalties["S3"].extend([below, above])

    # S4：避免休息间隔小于 3 天或连续工作超过最大值。
    minimum_gap = int(config["rules"]["workBetweenRestMin"])
    maximum_gap = int(config["rules"]["workBetweenRestMax"])
    for employee in employees:
        employee_id = employee["id"]
        for gap in range(1, minimum_gap):
            for start in range(0, len(dates) - gap - 1):
                too_close = and_var(model, f"rest_too_close_{employee_id}_{start}_{gap}", [
                    variables[(employee_id, dates[start], "OFF")],
                    variables[(employee_id, dates[start + gap + 1], "OFF")],
                ])
                soft_penalties["S4"].append(too_close)
        window = maximum_gap + 1
        for start in range(0, len(dates) - window + 1):
            no_rest = model.new_bool_var(f"long_work_{employee_id}_{start}")
            offs = [variables[(employee_id, day, "OFF")] for day in dates[start:start + window]]
            model.add(sum(offs) == 0).only_enforce_if(no_rest)
            model.add(sum(offs) >= 1).only_enforce_if(no_rest.Not())
            soft_penalties["S4"].append(no_rest)

    # S5：仅优化目标月内完整的周一至周日。
    first_date = date.fromisoformat(dates[0])
    last_date = date.fromisoformat(dates[-1])
    monday = first_date + timedelta(days=(7 - first_date.weekday()) % 7)
    while monday + timedelta(days=6) <= last_date:
        week_days = [(monday + timedelta(days=offset)).isoformat() for offset in range(7)]
        for employee in employees:
            works = [1 - variables[(employee["id"], day, "OFF")] for day in week_days]
            below = model.new_int_var(0, 7, f"weekly_below_{employee['id']}_{monday}")
            above = model.new_int_var(0, 7, f"weekly_above_{employee['id']}_{monday}")
            model.add(below >= int(config["rules"]["weeklyWorkMin"]) - sum(works))
            model.add(above >= sum(works) - int(config["rules"]["weeklyWorkMax"]))
            soft_penalties["S5"].extend([below, above])
        monday += timedelta(days=7)

    return BuiltModel(model, variables, employees, positions, dates, hard_penalties, soft_penalties, change_penalties)


def weighted_soft_expression(built: BuiltModel, request: dict[str, Any], keys: list[str]) -> cp_model.LinearExpr:
    weights = request["config"]["softConstraints"]["weights"]
    terms = []
    for key in keys:
        weight = int(weights.get(key, 1))
        terms.extend(value * weight for value in built.soft_penalties[key])
    return sum(terms) if terms else 0


def configure_solver(request: dict[str, Any], time_limit: float) -> cp_model.CpSolver:
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = max(0.05, time_limit)
    solver.parameters.random_seed = int(request.get("randomSeed", 1))
    solver.parameters.num_search_workers = 8
    return solver


def solve_built_model(built: BuiltModel, request: dict[str, Any], relaxed: bool) -> tuple[cp_model.CpSolver, int]:
    started = time.perf_counter()
    time_limit = float(request.get("timeLimitSeconds", 3.0))
    highest = list(dict.fromkeys(request["config"]["softConstraints"].get("highestPriority", [])))
    remaining = [key for key in ("S1", "S2", "S3", "S4", "S5") if key not in highest]

    hard = sum(built.hard_penalties) if built.hard_penalties else 0
    changes = sum(built.change_penalties) if built.change_penalties else 0
    highest_expression = weighted_soft_expression(built, request, highest)
    remaining_expression = weighted_soft_expression(built, request, remaining)
    # 使用确定的上界系数实现词典序：硬违规 > 调整单元格数量 > 最高层软约束 > 其余软约束。
    objective = hard * 10_000_000 + changes * 1_000_000 + highest_expression * 10_000 + remaining_expression
    built.model.minimize(objective)
    solver = configure_solver(request, time_limit)
    status = solver.solve(built.model)
    return solver, status


def extract_assignments(built: BuiltModel, solver: cp_model.CpSolver) -> list[dict[str, str]]:
    result: list[dict[str, str]] = []
    for employee in built.active_employees:
        for day in built.dates:
            for state in ["OFF", *[position["id"] for position in built.positions]]:
                variable = built.variables.get((employee["id"], day, state))
                if variable is not None and solver.value(variable) == 1:
                    result.append({"employeeId": employee["id"], "date": day, "state": state})
                    break
    return result


def solve_request(request: dict[str, Any]) -> dict[str, Any]:
    started = time.perf_counter()
    strict = build_model(request, relaxed=False)
    solver, status = solve_built_model(strict, request, relaxed=False)
    status_name = solver.status_name(status)
    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return {
            "solverVersion": SOLVER_VERSION,
            "solverStatus": status_name,
            "status": "PUBLISHABLE",
            "assignments": extract_assignments(strict, solver),
            "metrics": {
                "status": status_name,
                "wallTimeMs": round((time.perf_counter() - started) * 1000),
                "objectiveValue": solver.objective_value,
                "bestBound": solver.best_objective_bound,
                "conflicts": solver.num_conflicts,
                "branches": solver.num_branches,
            },
        }
    if status == cp_model.UNKNOWN:
        return {
            "solverVersion": SOLVER_VERSION,
            "solverStatus": status_name,
            "status": "TIMEOUT",
            "assignments": [],
            "metrics": {"status": status_name, "wallTimeMs": round((time.perf_counter() - started) * 1000)},
        }

    relaxed = build_model(request, relaxed=True)
    relaxed_request = {**request, "timeLimitSeconds": max(1.0, float(request.get("timeLimitSeconds", 3.0)))}
    relaxed_solver, relaxed_status = solve_built_model(relaxed, relaxed_request, relaxed=True)
    relaxed_name = relaxed_solver.status_name(relaxed_status)
    if relaxed_status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return {
            "solverVersion": SOLVER_VERSION,
            "solverStatus": relaxed_name,
            "status": "EXCEPTION",
            "assignments": extract_assignments(relaxed, relaxed_solver),
            "metrics": {
                "status": relaxed_name,
                "wallTimeMs": round((time.perf_counter() - started) * 1000),
                "objectiveValue": relaxed_solver.objective_value,
                "bestBound": relaxed_solver.best_objective_bound,
                "conflicts": relaxed_solver.num_conflicts,
                "branches": relaxed_solver.num_branches,
            },
        }
    return {
        "solverVersion": SOLVER_VERSION,
        "solverStatus": relaxed_name,
        "status": "INFEASIBLE",
        "assignments": [],
        "metrics": {"status": relaxed_name, "wallTimeMs": round((time.perf_counter() - started) * 1000)},
    }

