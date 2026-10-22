from __future__ import annotations

import argparse
import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
DEFAULT_BACKEND_PORT = 8000
DEFAULT_FRONTEND_PORT = 5173


def read_env(path: Path) -> dict[str, str]:
  values: dict[str, str] = {}
  if not path.is_file():
    return values
  for raw_line in path.read_text(encoding="utf-8").splitlines():
    line = raw_line.strip()
    if not line or line.startswith("#") or "=" not in line:
      continue
    key, value = line.split("=", 1)
    values[key.strip()] = value.strip().strip("\"'")
  return values


def port_number(value: str) -> int:
  try:
    port = int(value)
  except ValueError as error:
    raise argparse.ArgumentTypeError("port must be an integer") from error
  if not 1 <= port <= 65535:
    raise argparse.ArgumentTypeError("port must be between 1 and 65535")
  return port


def validate(
    local_env: dict[str, str],
    backend_port: int,
    frontend_port: int,
) -> list[str]:
  errors: list[str] = []
  for command in ("uv", "npm"):
    if shutil.which(command) is None:
      errors.append(f"Required command is unavailable: {command}")

  if backend_port == frontend_port:
    errors.append("BACKEND_PORT and FRONTEND_PORT must be different.")
  checkpoint_value = (
      os.environ.get("TIMESFM_CHECKPOINT_PATH")
      or local_env.get("TIMESFM_CHECKPOINT_PATH")
  )
  if not checkpoint_value:
    errors.append(
        "TIMESFM_CHECKPOINT_PATH is missing. Copy .env.example to .env and "
        "configure the local TimesFM checkpoint."
    )
  else:
    checkpoint = Path(checkpoint_value).expanduser()
    if not checkpoint.is_dir() or not any(checkpoint.iterdir()):
      errors.append(f"TimesFM checkpoint is missing or empty: {checkpoint}")
  return errors


def process_options() -> dict[str, object]:
  if os.name == "nt":
    return {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
  return {"start_new_session": True}


def stop_process(process: subprocess.Popen[bytes]) -> None:
  if process.poll() is not None:
    return
  if os.name == "nt":
    process.terminate()
  else:
    os.killpg(process.pid, signal.SIGTERM)
  try:
    process.wait(timeout=10)
  except subprocess.TimeoutExpired:
    if os.name == "nt":
      process.kill()
    else:
      os.killpg(process.pid, signal.SIGKILL)
    process.wait()


def merged_environment(local_env: dict[str, str]) -> dict[str, str]:
  environment = os.environ.copy()
  for key, value in local_env.items():
    environment.setdefault(key, value)
  return environment


def start_services(
    local_env: dict[str, str],
    backend_port: int,
    frontend_port: int,
) -> int:
  environment = merged_environment(local_env)
  backend_environment = environment.copy()
  frontend_origins = {
      f"http://localhost:{frontend_port}",
      f"http://127.0.0.1:{frontend_port}",
  }
  configured_origins = backend_environment.get("ALLOWED_ORIGINS", "")
  frontend_origins.update(
      origin.strip()
      for origin in configured_origins.split(",")
      if origin.strip()
  )
  backend_environment["ALLOWED_ORIGINS"] = ",".join(sorted(frontend_origins))
  frontend_environment = environment.copy()
  frontend_environment["VITE_PROXY_TARGET"] = (
      f"http://127.0.0.1:{backend_port}"
  )
  commands = [
      (
          "backend",
          [
              "uv",
              "run",
              "uvicorn",
              "app.main:app",
              "--reload",
              "--host",
              "127.0.0.1",
              "--port",
              str(backend_port),
          ],
          BACKEND,
          backend_environment,
      ),
      (
          "frontend",
          [
              "npm",
              "run",
              "dev",
              "--",
              "--host",
              "127.0.0.1",
              "--port",
              str(frontend_port),
              "--strictPort",
          ],
          FRONTEND,
          frontend_environment,
      ),
  ]
  processes: list[tuple[str, subprocess.Popen[bytes]]] = []
  stopping = False
  exit_code = 0

  def request_stop(signum: int, _frame: object) -> None:
    nonlocal stopping
    if not stopping:
      print(f"\nReceived signal {signum}; stopping services...", flush=True)
    stopping = True

  signal.signal(signal.SIGINT, request_stop)
  signal.signal(signal.SIGTERM, request_stop)

  try:
    print(
        "Portfolio tracker: backend worker after 18:00 Asia/Kolkata "
        "(no public port).",
        flush=True,
    )
    for name, command, cwd, service_environment in commands:
      print(f"Starting {name}: {' '.join(command)}", flush=True)
      process = subprocess.Popen(
          command,
          cwd=cwd,
          env=service_environment,
          **process_options(),
      )
      processes.append((name, process))

    while not stopping:
      for name, process in processes:
        return_code = process.poll()
        if return_code is not None:
          print(f"{name} exited with status {return_code}; stopping services.")
          exit_code = return_code
          stopping = True
          break
      time.sleep(0.5)
  finally:
    for _, process in reversed(processes):
      stop_process(process)

  return exit_code


def main() -> int:
  local_env = read_env(ROOT / ".env")
  parser = argparse.ArgumentParser(
      description="Start the TimeSeries backend and frontend development services."
  )
  parser.add_argument(
      "--check",
      action="store_true",
      help="Validate commands and TimesFM configuration without starting services.",
  )
  parser.add_argument(
      "--backend-port",
      type=port_number,
      default=(
          os.environ.get("BACKEND_PORT")
          or local_env.get("BACKEND_PORT")
          or str(DEFAULT_BACKEND_PORT)
      ),
      help="Dedicated backend port (default: 8000 or BACKEND_PORT).",
  )
  parser.add_argument(
      "--frontend-port",
      type=port_number,
      default=(
          os.environ.get("FRONTEND_PORT")
          or local_env.get("FRONTEND_PORT")
          or str(DEFAULT_FRONTEND_PORT)
      ),
      help="Dedicated frontend port (default: 5173 or FRONTEND_PORT).",
  )
  args = parser.parse_args()

  errors = validate(local_env, args.backend_port, args.frontend_port)
  if errors:
    for error in errors:
      print(f"ERROR: {error}", file=sys.stderr)
    return 1
  if args.check:
    print(
        "Startup prerequisites are valid: "
        f"backend={args.backend_port}, frontend={args.frontend_port}, "
        "portfolio tracker=backend worker."
    )
    return 0
  return start_services(local_env, args.backend_port, args.frontend_port)


if __name__ == "__main__":
  raise SystemExit(main())
