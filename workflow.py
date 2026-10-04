"""Task slot entry point — imports SDK workflow bindings, loads task_script.

平台交互面在 allybuild_sdk.workflow（env 解析 + client 构建 + SDK 绑定）；
本文件是沙箱 slot 的运行入口（与 task_script.py 同目录上传）。task_script
的 `from workflow import X` 经 sys.modules 别名直达 allybuild_sdk.workflow。
"""
import importlib.util
import json
import os
import sys

# 从 SDK 包导入工作流绑定面；把 SDK 模块别名到 "workflow" 让 task_script
# 的 `from workflow import X` 直接命中。
from allybuild_sdk import workflow as _wf
sys.modules.setdefault("workflow", _wf)

params = _wf.params
reporter = _wf.reporter
flush_tasks = _wf.flush_tasks

if __name__ == "__main__":
    _here = os.path.dirname(os.path.abspath(__file__))
    sys.path.append(_here)
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
