"""Task slot runner — script 模式任务的执行入口。

平台交互面（env 解析 + client 构建 + SDK 绑定）在
sdk/python/allybuild_sdk/workflow.py，worker 上传到 slot 为 workflow.py；
本文件上传为 runner.py 作入口：`import workflow` 走自然模块解析（无需
sys.modules 别名），随后加载 task_script 并按 Convention 1（run）或
on_change dispatch。绑定面只依赖稳定 SDK API（≥1.1.0），任意镜像可跑。
"""
import importlib.util
import json
import os
import sys

_here = os.path.dirname(os.path.abspath(__file__))
sys.path.append(_here)

from workflow import flush_tasks, params, reporter  # noqa: E402

# -- Load and run task_script --
if __name__ == "__main__":
    try:
        spec = importlib.util.spec_from_file_location(
            "task_script", os.path.join(_here, "task_script.py"))
        mod = importlib.util.module_from_spec(spec)
        sys.modules["task_script"] = mod
        spec.loader.exec_module(mod)

        if callable(getattr(mod, "on_change", None)) and params.get("trigger") == "on_change":
            import asyncio as _asyncio
            fn = mod.on_change
            args = (params.get("mutation") or {}, params.get("state") or {})
            if _asyncio.iscoroutinefunction(fn):
                ret = _asyncio.run(fn(*args))
            else:
                ret = fn(*args)
            flush_tasks()
            if ret is not None:
                print(f"[RESULT] {json.dumps(ret, ensure_ascii=False, default=str)}", flush=True)
        elif callable(getattr(mod, "run", None)):
            import asyncio as _asyncio
            if _asyncio.iscoroutinefunction(mod.run):
                ret = _asyncio.run(mod.run(params, reporter))
            else:
                ret = mod.run(params, reporter)
            flush_tasks()
            if ret is not None:
                print(f"[RESULT] {json.dumps(ret, ensure_ascii=False, default=str)}", flush=True)
    except SystemExit:
        raise
    except Exception:
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
