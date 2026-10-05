#!/usr/bin/env python3
"""Deploy dsh-server to a Daytona sandbox and hand back the connection URL.

Flow:
  1. Authenticate the Daytona CLI (DAYTONA_API_KEY env or --api-key).
  2. Ensure a snapshot exists, built from the published ghcr image (default;
     Daytona pulls it with the organization's configured registry credentials)
     or from the repo Dockerfile (--source dockerfile, no registry needed).
  3. Ensure the sandbox runs from that snapshot (create, or start when stopped).
  4. Wait for dsh to print its authenticated URL and extract the token.
  5. Derive the stable routing domain from the sandbox hostname (its UUID) and
     health-check the /api trust fence.
  6. Print the stable URL and launch token.

Stdlib only; the Daytona CLI must be on PATH.
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

DEFAULT_IMAGE_REPO = "ghcr.io/allybuild/dsh-allybuild"
NPM_LATEST_URL = "https://registry.npmjs.org/@deepseek-ai%2Fdsh/latest"
DEFAULT_SANDBOX = "dsh-server"
DEFAULT_SNAPSHOT = "dsh-server"
DEFAULT_PREVIEW_DOMAIN = "daytonaproxy01.net"
# 构建上下文 = 主仓根（Dockerfile 的 COPY 覆盖 runtime/* 与 sdk/*——SDK 已
# 移到仓库根，从 runtime/ 内构建拿不到 sdk/）
DEFAULT_REPO_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DOCKERFILE_CONTEXT = [
    "runtime/Dockerfile",
    "runtime/dsh-entrypoint.sh",
    "runtime/docker-overlay.yml",
    "runtime/merge-overlay.py",
    "runtime/mcp-overlay.py",
    "runtime/agent-overlay.yml",
    "runtime/allybuild-overlay",
    "runtime/web-minimal",
    "sdk/python",
    "sdk/ts",
]


def log(message: str) -> None:
    print(f"[deploy] {message}", flush=True)


def resolve_image(image: str | None) -> str:
    """Pin the image tag to the released dsh version: Daytona refuses :latest,
    and the release workflow tags every image with the dsh version it ships."""
    if image:
        return image
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(NPM_LATEST_URL, timeout=30) as response:
                version = str(json.load(response)["version"])
            return f"{DEFAULT_IMAGE_REPO}:{version}"
        except (OSError, ValueError, KeyError) as error:
            last_error = error
            time.sleep(2 * (attempt + 1))
    raise SystemExit(
        f"[deploy] could not resolve the released dsh version from npm ({last_error}); "
        f"pass --image {DEFAULT_IMAGE_REPO}:<tag>"
    )
    return f"{DEFAULT_IMAGE_REPO}:{version}"


def cli(*args: str, timeout: int = 600) -> str:
    """Run one daytona CLI command and return its cleaned stdout."""
    result = subprocess.run(
        ["daytona", *args],
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    stdout = "\n".join(
        line for line in result.stdout.splitlines() if not line.startswith("time=")
    )
    if result.returncode != 0:
        stderr_tail = "\n".join(result.stderr.splitlines()[-15:])
        raise RuntimeError(
            f"daytona {' '.join(args)} failed:\n{stdout}\n{stderr_tail}".strip()
        )
    return stdout


def exec_in(sandbox: str, *args: str, timeout: int = 60) -> str:
    return cli("exec", sandbox, "--", *args, timeout=timeout)


def ensure_authenticated(api_key: str | None) -> None:
    try:
        cli("list", timeout=60)
        return
    except RuntimeError:
        pass
    if not api_key:
        raise SystemExit(
            "[deploy] daytona not authenticated; pass --api-key or set DAYTONA_API_KEY"
        )
    log("authenticating daytona CLI")
    cli("login", "--api-key", api_key, timeout=120)


def snapshot_exists(name: str) -> bool:
    listing = cli("snapshot", "list", timeout=120)
    return any(entry.split()[0] == name for entry in re.findall(r"\[([^\]]+)\]", listing))


def create_snapshot(name: str, source: str, image: str, repo_dir: str) -> None:
    log(f"creating snapshot {name!r} from {source}")
    if source == "image":
        args = ("snapshot", "create", name, "-i", image,
                "--memory", "2", "--disk", "5", "--sandbox-class", "container")
    else:
        for filename in DOCKERFILE_CONTEXT:
            if not os.path.exists(os.path.join(repo_dir, filename)):
                raise SystemExit(f"[deploy] missing {filename} under {repo_dir}")
        # The build context is auto-determined from the Dockerfile's COPY/ADD
        # commands; explicit -c uploads proved unreliable for directories
        # across CLI versions (dirs silently missing from the remote context).
        # -f 相对调用方 cwd 解析：绝对化后统一从 repo 根出发。
        dockerfile = os.path.relpath(
            os.path.join(repo_dir, "runtime", "Dockerfile"), os.getcwd())
        args = ["snapshot", "create", name, "-f", dockerfile,
                "--memory", "2", "--disk", "5", "--sandbox-class", "container"]
    try:
        cli(*args, timeout=1200)
    except RuntimeError as error:
        if source == "image" and ("unauthorized" in error.args[0].lower()
                                  or "denied" in error.args[0].lower()):
            raise SystemExit(
                "[deploy] the registry refused the image pull; check that the ghcr "
                "package exists and that the Daytona organization has its credentials "
                f"configured, or retry with --source dockerfile\n{error}"
            )
        raise
    log("snapshot ready")


def delete_sandbox(name: str) -> None:
    """Delete the sandbox before its snapshot: a snapshot referenced by a
    sandbox deletes lazily (the backend defers removal until the last
    consumer is gone), and recreating the snapshot then conflicts for many
    minutes."""
    if sandbox_state(name) is not None:
        log(f"deleting existing sandbox {name!r}")
        cli("delete", name, timeout=300)


def ensure_snapshot(name: str, source: str, image: str, repo_dir: str, refresh: bool) -> None:
    exists = snapshot_exists(name)
    if exists and refresh:
        log(f"deleting stale snapshot {name!r}")
        cli("snapshot", "delete", name, timeout=300)
        # Deletion settles asynchronously; a recreate that races it conflicts.
        deadline = time.time() + 600
        while snapshot_exists(name):
            if time.time() > deadline:
                raise SystemExit(
                    "[deploy] the deleted snapshot has not settled; rerun in a minute"
                )
            time.sleep(5)
        exists = False
    if exists:
        log(f"reusing snapshot {name!r}")
        return
    for attempt in range(10):
        try:
            create_snapshot(name, source, image, repo_dir)
            log("snapshot ready")
            return
        except RuntimeError as error:
            # The list view can show the deletion settled long before the
            # backend finishes removing a large image snapshot; re-issue the
            # delete on every conflict — once the last referencing sandbox is
            # gone it completes immediately.
            if "conflict" in error.args[0].lower() and attempt < 9:
                log("snapshot still settling; re-deleting (30s)")
                try:
                    cli("snapshot", "delete", name, timeout=300)
                except RuntimeError:
                    pass
                time.sleep(30)
            else:
                raise


def sandbox_state(name: str) -> str | None:
    try:
        info = cli("info", name, timeout=120)
    except RuntimeError as error:
        if "not found" in error.args[0].lower():
            return None
        raise
    match = re.search(r"^State\s+(\S+)", info, re.MULTILINE)
    return match.group(1) if match else None


def ensure_sandbox(name: str, snapshot: str, force: bool, env: dict[str, str]) -> None:
    state = sandbox_state(name)
    if state is not None and force:
        log(f"deleting existing sandbox {name!r}")
        cli("delete", name, timeout=300)
        state = None
    if state is None:
        log(f"creating sandbox {name!r} from snapshot {snapshot!r}")
        args = ["create", "--snapshot", snapshot, "--name", name,
                "--auto-stop", "0", "--public"]
        for key, value in env.items():
            args += ["-e", f"{key}={value}"]
        cli(*args, timeout=900)
    elif state != "STARTED":
        log(f"starting stopped sandbox {name!r}")
        cli("start", name, timeout=600)
        if env:
            log("note: forwarded environment only applies at sandbox creation; "
                "delete and rerun to apply new values")
    else:
        log(f"sandbox {name!r} already running")
        if env:
            log("note: forwarded environment only applies at sandbox creation; "
                "delete and rerun to apply new values")
    log("sandbox started")


ALLYBUILD_ENV_KEYS = (
    "ALLYBUILD_SESSION_URL",
    "ALLYBUILD_PROGRESS_URL",
    "ALLYBUILD_ANSWER_URL",
    "ALLYBUILD_TOKEN",
    "ALLYBUILD_AGENT_ID",
    "DSH_TRUSTED_ORIGINS",
)


def allybuild_env() -> dict[str, str]:
    """Forward the AllyBuild integration environment to the sandbox, where the
    composition patch reads it at boot."""
    return {key: value for key in ALLYBUILD_ENV_KEYS if os.environ.get(key)}


def wait_for_boot(name: str, timeout: int) -> tuple[str, str | None]:
    """Wait for the boot line and return (url, token). The token is None under
    the authless container overlay (the deployment sits behind the sandbox
    preview auth); with browser auth the printed URL carries ?token=."""
    deadline = time.time() + timeout
    pattern = re.compile(r"dsh web: (\S+)")
    last = ""
    while time.time() < deadline:
        try:
            log_content = exec_in(name, "cat", "/tmp/dsh.log", timeout=60)
        except RuntimeError as error:
            last = error.args[0]
            time.sleep(5)
            continue
        match = pattern.search(log_content)
        if match:
            url = match.group(1)
            token_match = re.search(r"token=([A-Za-z0-9_-]+)", url)
            return url, token_match.group(1) if token_match else None
        last = log_content.strip() or "(log empty)"
        time.sleep(5)
    raise SystemExit(
        f"[deploy] dsh did not report its URL within {timeout}s; last log: {last[-400:]}"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--api-key", default=os.environ.get("DAYTONA_API_KEY"))
    parser.add_argument("--name", default=DEFAULT_SANDBOX, help="sandbox name")
    parser.add_argument("--snapshot", default=DEFAULT_SNAPSHOT, help="snapshot name")
    parser.add_argument("--image", default=None,
                        help="image with an explicit tag (default: resolve the "
                             "released dsh version from npm)")
    parser.add_argument("--source", choices=("image", "dockerfile"), default="image")
    parser.add_argument("--repo-dir", default=DEFAULT_REPO_DIR,
                        help="repo root for --source dockerfile")
    parser.add_argument("--refresh-snapshot", action="store_true",
                        help="delete and rebuild the snapshot even if it exists")
    parser.add_argument("--force-recreate", action="store_true",
                        help="delete and recreate the sandbox even if it exists")
    parser.add_argument("--preview-domain", default=DEFAULT_PREVIEW_DOMAIN)
    parser.add_argument("--port", type=int, default=3080)
    parser.add_argument("--wait-timeout", type=int, default=240)
    args = parser.parse_args()

    if shutil.which("daytona") is None:
        raise SystemExit("[deploy] daytona CLI not found on PATH")
    ensure_authenticated(args.api_key)
    image = resolve_image(args.image)
    log(f"image: {image}")
    # A rebuilt snapshot leaves any existing sandbox stale, so the sandbox
    # goes first — a snapshot its sandbox still references deletes lazily and
    # the recreate would conflict.
    if args.refresh_snapshot or args.force_recreate:
        delete_sandbox(args.name)
    ensure_snapshot(args.snapshot, args.source, image, args.repo_dir,
                    args.refresh_snapshot)
    ensure_sandbox(args.name, args.snapshot, False, allybuild_env())

    log("waiting for dsh to boot")
    boot_url, token = wait_for_boot(args.name, args.wait_timeout)
    uuid = exec_in(args.name, "hostname", timeout=60).strip()
    url = f"https://{args.port}-{uuid}.{args.preview_domain}"

    try:
        request = urllib.request.Request(f"{url}/api/settings/describe")
        urllib.request.urlopen(request, timeout=30)
        fence = "unexpected 200"
    except urllib.error.HTTPError as error:
        fence = {401: "trusted (401 unauthenticated)", 403: "UNTRUSTED (403)"}.get(
            error.code, f"HTTP {error.code}")
    except OSError as error:
        fence = f"unreachable ({error})"
    log(f"/api fence: {fence}")

    upstream = f"https://{args.port}-{uuid}.{args.preview_domain}"
    print("\n=== dsh-server on Daytona ===")
    print(f"stable URL : {url}")
    if token:
        print(f"token      : {token}")
    print(f"api origin : {upstream}")


if __name__ == "__main__":
    main()
