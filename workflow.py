"""Task slot entry point — workflow shell（绑定面 + 运行入口，自包含）。

只依赖 allybuild_sdk 稳定 API（≥1.1.0：client/tasks/agents/memories/okf/
mcp/status/reactive），不依赖包内 workflow 模块，任意沙箱镜像可直接跑。
上传时与 task_script.py 同目录；task_script 的 `from workflow import X`
经 sys.modules 别名直达本模块。

模块级变量：params / reporter / TASK_ID / PROJECT_ID / TASK_JWT /
ALLYBUILD_API_URL / project_status / project_tokens / create_task /
wait_task / feedback / flush_tasks / list_tasks / get_task / mcp /
mcp_call / list_agents / list_workspaces / list_task_type_memories /
get_task_memories / okf_search / okf_lint / defineStore / action /
getter / field / create_reactive。
"""
import importlib.util
import json
import os
import sys

from allybuild_sdk import (
    AllyBuildClient, ScriptContext, Reporter, TasksApi,
    AgentsApi, MemoriesApi, OkfApi, McpApi, ProjectStatusProxy,
)
from allybuild_sdk.reactive import (
    defineStore, action, getter, field, create_reactive, HttpBackend,
)

# -- Injected context --
TASK_ID             = os.environ.get("TASK_ID", "")
PROJECT_ID          = os.environ.get("PROJECT_ID", "")
TASK_JWT            = os.environ.get("TASK_JWT", "")
ALLYBUILD_API_URL   = os.environ.get("ALLYBUILD_API_URL", "")
BG_SERVICE_ID       = os.environ.get("BG_SERVICE_ID", "")
SERVICE_WORKSPACE_ID = os.environ.get("ALLYBUILD_WORKSPACE_ID", "")

try:
    params = json.loads(os.environ.get("TASK_PARAMS", "{}"))
except Exception:
    params = {}

try:
    project_tokens = json.loads(os.environ.get("ALLYBUILD_PROJECT_TOKENS", "{}"))
except Exception:
    project_tokens = {}

client = AllyBuildClient(ALLYBUILD_API_URL, TASK_JWT, PROJECT_ID)

reporter = Reporter()

# -- Reactive backend init（HTTP mediate；容器无 Redis URL）--
_status_backend = None
if ALLYBUILD_API_URL:
    try:
        _status_backend = HttpBackend(api_url=ALLYBUILD_API_URL, jwt=TASK_JWT, project_id=PROJECT_ID)
        create_reactive(redis=_status_backend)
    except Exception as _exc:
        import logging as _log
        _log.getLogger(__name__).warning(
            "project_status: reactive init failed, using in-memory mode: %s", _exc)

project_status = ProjectStatusProxy(client=client, backend=_status_backend)

_ctx = ScriptContext(
    task_id=TASK_ID, bg_service_id=BG_SERVICE_ID, service_workspace_id=SERVICE_WORKSPACE_ID)

_tasks = TasksApi(client, _ctx)
create_task = _tasks.create
wait_task = _tasks.wait
feedback = _tasks.feedback
flush_tasks = _tasks.flush
list_tasks = _tasks.list
get_task = _tasks.get

_mcp = McpApi(client)
mcp = _mcp.mcp
mcp_call = _mcp.mcp_call
# async_mcp_call 在 SDK >1.1.0 才有；防御性绑定
_async_mcp_call = getattr(_mcp, "async_mcp_call", None)
if _async_mcp_call is not None:
    async_mcp_call = _async_mcp_call

_agents = AgentsApi(client)
list_agents = _agents.list_agents
list_workspaces = _agents.list_workspaces

_memories = MemoriesApi(client)
list_task_type_memories = _memories.list_task_type_memories
get_task_memories = _memories.get_task_memories

_okf = OkfApi(client)
okf_search = _okf.search
okf_lint = _okf.lint

# task_script 的 `from workflow import X` 直达本模块
sys.modules.setdefault("workflow", sys.modules["__main__"])

# -- Load and run task_script --
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
