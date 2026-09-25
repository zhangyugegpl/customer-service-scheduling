from __future__ import annotations

import argparse
import json
import sys
import traceback

from model import SOLVER_VERSION, solve_request


def write_json(value: object) -> None:
    sys.stdout.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")))
    sys.stdout.flush()


def main() -> int:
    parser = argparse.ArgumentParser(description="客服排班 CP-SAT 求解器")
    parser.add_argument("--health", action="store_true", help="验证求解器运行环境")
    parser.add_argument("--version", action="store_true", help="输出求解器版本")
    args = parser.parse_args()
    if args.health:
        write_json({"ok": True, "solverVersion": SOLVER_VERSION})
        return 0
    if args.version:
        write_json({"solverVersion": SOLVER_VERSION})
        return 0
    try:
        request = json.load(sys.stdin)
        write_json(solve_request(request))
        return 0
    except Exception as error:  # noqa: BLE001 - 顶层协议必须返回结构化错误
        write_json({
            "status": "ERROR",
            "solverVersion": SOLVER_VERSION,
            "error": str(error),
            "trace": traceback.format_exc(limit=8),
        })
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

